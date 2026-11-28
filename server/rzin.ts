import { GoogleGenAI, ThinkingLevel, Type, type Content } from '@google/genai';
import type { Product, RzinRecommendation } from '../src/types.ts';
import { db, mapProductRow, mapSettingsRow } from './db.ts';

let cachedClient: GoogleGenAI | null = null;
let cachedKey: string | undefined;

function getAiClient(): GoogleGenAI {
  const apiKey = (process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error(
      'GEMINI_API_KEY não configurada no ambiente do servidor. Configure a chave em Configurações > Segredos.'
    );
  }
  if (!cachedClient || cachedKey !== apiKey) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
    cachedKey = apiKey;
  }
  return cachedClient;
}

export interface RzinInputMessage {
  role: 'user' | 'model';
  text: string;
}

interface RawModelRecommendation {
  productId?: number;
  brandOrLine?: string;
  variation?: string;
  flavorDescription?: string;
  matchReason?: string;
}

interface RawModelResponse {
  reply?: string;
  recommendations?: RawModelRecommendation[];
}

const RESPONSE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    reply: {
      type: Type.STRING,
      description:
        'Resposta natural, simpática e descontraída do RZIN em português do Brasil, conduzindo a conversa ou apresentando as recomendações.',
    },
    recommendations: {
      type: Type.ARRAY,
      description:
        'Lista de produtos REAIS do catálogo recomendados nesta mensagem. Deixe vazio ([]) se ainda estiver fazendo perguntas de descoberta ou se nenhuma opção disponível combinar.',
      items: {
        type: Type.OBJECT,
        properties: {
          productId: {
            type: Type.INTEGER,
            description: 'ID numérico exato do produto ativo no catálogo da R&P Tabacaria.',
          },
          brandOrLine: {
            type: Type.STRING,
            description: 'Marca ou linha do produto (ex: R&P Tabacaria, Essência Premium Blend 250g, etc.).',
          },
          variation: {
            type: Type.STRING,
            description: 'Sabor ou variação exata disponível dentro de variations do produto escolhido.',
          },
          flavorDescription: {
            type: Type.STRING,
            description: 'Descrição objetiva do perfil de sabor desta essência/produto.',
          },
          matchReason: {
            type: Type.STRING,
            description: 'Explicação clara de por que combina com o gosto e restrições informados pelo cliente.',
          },
        },
        required: ['productId', 'brandOrLine', 'variation', 'flavorDescription', 'matchReason'],
      },
    },
  },
  required: ['reply', 'recommendations'],
};

function buildSystemInstruction(products: Product[], storeOpen: boolean, storeName: string): string {
  const essences = products.filter((p) => p.category.toLowerCase().includes('essênc') || p.category.toLowerCase().includes('essenc'));
  const otherProducts = products.filter((p) => !essences.some((e) => e.id === p.id));

  const catalogPayload = {
    storeName,
    storeCurrentlyOpen: storeOpen,
    essencesCatalog: essences.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      priceBRL: p.price,
      availableFlavors: p.variations,
      secondaryOptions: p.secondaryVariations || [],
      hasPhoto: Boolean(p.imageUrl),
      inStock: p.active,
    })),
    otherAvailableProducts: otherProducts.map((p) => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      priceBRL: p.price,
      availableVariations: p.variations,
      secondaryOptions: p.secondaryVariations || [],
      hasPhoto: Boolean(p.imageUrl),
      inStock: p.active,
    })),
  };

  return `Você é o RZIN, o assistente virtual oficial e mascote da ${storeName} (um guaxinim estiloso de boné e óculos escuros da R&P).

PERSONALIDADE E TOM DE VOZ:
- Seja simpático, estiloso, descontraído, carismático e natural — como um atendente jovem e gente boa conversando direto no balcão da loja.
- Use gírias leves e moderadas ("salve", "fechou", "massa", "curte", "bora", "combina demais"), sem exageros e sem parecer robô ou formulário.
- Use emojis com moderação (1 a 3 por mensagem quando fizer sentido).
- Dê explicações simples, diretas e objetivas.
- NUNCA pressione o cliente a comprar.

OBJETIVO PRINCIPAL:
- Você é especialista no catálogo de essências da ${storeName}.
- Ajude o cliente a descobrir qual essência (e sabor/variação) realmente disponível no catálogo combina mais com os gostos pessoais dele.
- Se o cliente pedir outro item da loja (ex: pod, carvão, rosh, narguilé), você também pode ajudar usando os produtos reais cadastrados em otherAvailableProducts.

COMO CONDUZIR A CONVERSA:
1. Converse de forma natural e interativa. NÃO faça todas as perguntas de uma vez — faça no máximo 1 ou 2 perguntas leves por turno quando ainda precisar entender o perfil do cliente.
2. Perguntas úteis para descobrir o perfil (use aos poucos conforme a conversa):
   - Gosta mais de sabores doces ou cítricos?
   - Prefere frutas vermelhas, tropicais ou mais refrescantes?
   - Curte sabores gelados (Ice/Mint/Mentol) ou prefere sem gelo?
   - Prefere sabores mais suaves ou marcantes?
   - Tem alguma essência ou sabor que já experimentou e curtiu?
3. Aprenda com tudo que o cliente disser durante o histórico da conversa (incluindo restrições como "não gosto de mentol", "sem menta", "nada muito enjoativo") e respeite essas preferências nas recomendações seguintes.
4. Quando já tiver informação suficiente para sugerir opções reais (ou quando o cliente já disser claramente o que curte, ex: "gosto de morango, melancia e sabores docinhos"), analise o catálogo REAL abaixo e retorne as recomendações compatíveis no campo "recommendations" do JSON, explicando no "reply" o perfil identificado de forma natural.
5. Se o cliente informar uma restrição (ex: "quero morango com uva, mas sem mentol"), filtre cuidadosamente os sabores disponíveis no catálogo evitando sabores Ice/Mint/Menthol/Hortelã.

REGRAS OBRIGATÓRIAS DO CATÁLOGO (ZERO INVENÇÃO):
- Recomende SOMENTE produtos existentes no catálogo JSON abaixo (todos estão ativos e disponíveis).
- NUNCA invente nomes de essências, marcas inexistentes, sabores fora de availableFlavors/availableVariations ou preços diferentes dos listados.
- NUNCA recomende produtos indisponíveis ou fora do catálogo como se estivessem à venda.
- Se não houver nenhuma combinação adequada no catálogo atual (por exemplo, se todas as frutas disponíveis tiverem toque gelado e o cliente não quiser mentol, ou se não houver o sabor pedido), informe isso com total honestidade e transparência ao cliente, sugerindo apenas o que realmente chega mais perto se fizer sentido, sem inventar nada.
- Use o campo "recommendations" apenas com productId e variation exatos do catálogo abaixo.

REGRAS DE SEGURANÇA E CONFORMIDADE:
- Atenda apenas adultos com idade legal (+18 anos) para adquirir produtos de tabacaria. Se o usuário mencionar ser menor de 18 anos, recuse educadamente as recomendações.
- Respeite a legislação aplicável.
- NUNCA faça alegações de que os produtos são seguros, saudáveis ou isentos de riscos à saúde.

FORMATO DE SAÍDA:
- Responda exclusivamente no JSON estruturado definido pelo schema ("reply" e "recommendations").
- Seja conciso no "reply" (geralmente 2 a 5 frases curtas), deixando os detalhes estruturados (nome, marca, descrição do sabor, motivo da combinação, foto, preço e disponibilidade) aparecerem nos cards de "recommendations".

CATÁLOGO REAL ATUALIZADO DA LOJA:
${JSON.stringify(catalogPayload)}`;
}

async function generateWithRetry(
  ai: GoogleGenAI,
  contents: Content[],
  systemInstruction: string
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents,
        config: {
          systemInstruction,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
        },
      });
      const text = (response.text || '').trim();
      if (!text) {
        throw new Error('Resposta vazia do modelo.');
      }
      return text;
    } catch (err: unknown) {
      lastError = err;
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? Number((err as { status?: unknown }).status)
          : 0;
      const retryable = status === 429 || status >= 500 || status === 0;
      if (!retryable || attempt === 2) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * Math.pow(2, attempt)));
    }
  }
  throw lastError;
}

export async function runRzinChat(messages: RzinInputMessage[]): Promise<{
  reply: string;
  recommendations: RzinRecommendation[];
}> {
  const ai = getAiClient();

  const productRows = db
    .prepare('SELECT * FROM products WHERE active = 1 AND archived = 0 ORDER BY id DESC')
    .all() as Record<string, unknown>[];
  const activeProducts = productRows.map(mapProductRow);
  const productMap = new Map<number, Product>(activeProducts.map((p) => [p.id, p]));

  const settingsRow = db.prepare('SELECT * FROM store_settings WHERE id = 1').get() as Record<string, unknown>;
  const settings = mapSettingsRow(settingsRow);

  const systemInstruction = buildSystemInstruction(activeProducts, settings.storeOpen, settings.storeName);

  const contents: Content[] = messages.slice(-12).map((msg) => ({
    role: msg.role === 'model' ? 'model' : 'user',
    parts: [{ text: msg.text }],
  }));

  const rawText = await generateWithRetry(ai, contents, systemInstruction);

  let parsed: RawModelResponse;
  try {
    parsed = JSON.parse(rawText) as RawModelResponse;
  } catch {
    return {
      reply: rawText,
      recommendations: [],
    };
  }

  const reply =
    typeof parsed.reply === 'string' && parsed.reply.trim()
      ? parsed.reply.trim()
      : 'Salve! Me conta um pouco mais sobre os sabores que você curte pra eu achar a essência ideal no catálogo.';

  const rawRecs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
  const seenKeys = new Set<string>();
  const verifiedRecommendations: RzinRecommendation[] = [];

  for (const rec of rawRecs) {
    const productId = Number(rec.productId);
    if (!Number.isInteger(productId)) continue;
    const realProduct = productMap.get(productId);
    if (!realProduct || !realProduct.active) continue;

    // Match variation against real catalog variations (case-insensitive fallback)
    const requestedVar = typeof rec.variation === 'string' ? rec.variation.trim() : '';
    const matchedVar =
      realProduct.variations.find((v) => v.toLowerCase() === requestedVar.toLowerCase()) ||
      realProduct.variations[0] ||
      'Padrão';

    const dedupeKey = `${realProduct.id}::${matchedVar.toLowerCase()}`;
    if (seenKeys.has(dedupeKey)) continue;
    seenKeys.add(dedupeKey);

    verifiedRecommendations.push({
      productId: realProduct.id,
      name: realProduct.name,
      brandOrLine:
        typeof rec.brandOrLine === 'string' && rec.brandOrLine.trim()
          ? rec.brandOrLine.trim()
          : settings.storeName,
      category: realProduct.category,
      variation: matchedVar,
      flavorDescription:
        typeof rec.flavorDescription === 'string' && rec.flavorDescription.trim()
          ? rec.flavorDescription.trim()
          : realProduct.description || `Sabor ${matchedVar}`,
      matchReason:
        typeof rec.matchReason === 'string' && rec.matchReason.trim()
          ? rec.matchReason.trim()
          : 'Combina com o perfil de sabor que você descreveu.',
      price: realProduct.price,
      imageUrl: realProduct.imageUrl,
      available: realProduct.active,
    });
  }

  return {
    reply,
    recommendations: verifiedRecommendations,
  };
}
