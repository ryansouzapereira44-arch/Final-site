import { db } from './db.ts';
import { sendRouletteCouponExpiringEmail } from './mailer.ts';

export const ROULETTE_COUPON_VALIDITY_DAYS = 7;
export const ROULETTE_COUPON_VALIDITY_MS = ROULETTE_COUPON_VALIDITY_DAYS * 24 * 60 * 60 * 1000;
const REMINDER_BEFORE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 6th day of a 7-day coupon (1 day remaining)
const POLL_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

interface ExpiringCouponCandidate {
  id: number;
  code: string;
  discountType: string;
  discountValue: number;
  freeShipping: number;
  expiresAt: string;
  customerName: string;
  customerEmail: string;
}

function formatCouponBenefitLabel(row: ExpiringCouponCandidate): string {
  if (Number(row.freeShipping) === 1 || row.discountType === 'free_shipping') {
    return 'Frete Grátis';
  }
  if (row.discountType === 'percent') {
    return `${Number(row.discountValue)}% de desconto`;
  }
  return `R$ ${Number(row.discountValue).toFixed(2).replace('.', ',')} de desconto`;
}

let reminderJobRunning = false;

export async function processExpiringRouletteCoupons(
  nowMs: number = Date.now()
): Promise<{ checked: number; sent: number }> {
  if (reminderJobRunning) {
    return { checked: 0, sent: 0 };
  }
  reminderJobRunning = true;

  try {
    const nowIso = new Date(nowMs).toISOString();
    const oneDayAheadIso = new Date(nowMs + REMINDER_BEFORE_EXPIRY_MS).toISOString();

    // Ensure any already-expired coupons are deactivated first
    db.prepare('UPDATE coupons SET active = 0 WHERE expiresAt IS NOT NULL AND expiresAt <= ? AND active = 1').run(
      nowIso
    );

    const candidates = db
      .prepare(
        `SELECT
           c.id,
           c.code,
           c.discountType,
           c.discountValue,
           c.freeShipping,
           c.expiresAt,
           u.name AS customerName,
           u.email AS customerEmail
         FROM coupons c
         JOIN users u ON u.id = c.ownerUserId
         WHERE c.ownerUserId IS NOT NULL
           AND c.active = 1
           AND c.usageCount = 0
           AND (c.maxUses IS NULL OR c.usageCount < c.maxUses)
           AND NOT EXISTS (SELECT 1 FROM coupon_usages cu WHERE cu.couponId = c.id)
           AND c.expiresAt IS NOT NULL
           AND c.expiresAt > ?
           AND c.expiresAt <= ?
           AND c.expirationReminderSentAt IS NULL
           AND u.active = 1
           AND COALESCE(u.archived, 0) = 0
         ORDER BY c.expiresAt ASC, c.id ASC`
      )
      .all(nowIso, oneDayAheadIso) as unknown as ExpiringCouponCandidate[];

    let sent = 0;

    for (const candidate of candidates) {
      const claim = db
        .prepare(
          `UPDATE coupons
           SET expirationReminderSentAt = ?
           WHERE id = ?
             AND expirationReminderSentAt IS NULL
             AND active = 1
             AND usageCount = 0`
        )
        .run(nowIso, candidate.id);

      if (claim.changes !== 1) {
        continue;
      }

      const delivery = await sendRouletteCouponExpiringEmail({
        toEmail: String(candidate.customerEmail),
        recipientName: String(candidate.customerName || 'Cliente'),
        couponCode: String(candidate.code),
        benefitLabel: formatCouponBenefitLabel(candidate),
        expiresAtIso: String(candidate.expiresAt),
      });

      if (delivery.delivered) {
        sent += 1;
      } else {
        db.prepare('UPDATE coupons SET expirationReminderSentAt = NULL WHERE id = ?').run(candidate.id);
      }
    }

    return { checked: candidates.length, sent };
  } finally {
    reminderJobRunning = false;
  }
}

export function startCouponReminderScheduler(): () => void {
  const startupTimer = setTimeout(() => {
    void processExpiringRouletteCoupons().catch((err) => {
      console.error('[CouponReminder] Erro na verificação inicial:', err);
    });
  }, 5000);
  startupTimer.unref?.();

  const intervalTimer = setInterval(() => {
    void processExpiringRouletteCoupons().catch((err) => {
      console.error('[CouponReminder] Erro na verificação periódica:', err);
    });
  }, POLL_INTERVAL_MS);
  intervalTimer.unref?.();

  return () => {
    clearTimeout(startupTimer);
    clearInterval(intervalTimer);
  };
}
