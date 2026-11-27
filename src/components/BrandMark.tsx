import { useEffect, useState } from 'react';
import { Package } from 'lucide-react';

export function BrandLogoSVG({ size = 40 }: { size?: number }) {
  const [errored, setErrored] = useState(false);

  if (errored) {
    return (
      <div
        style={{ width: size, height: size }}
        className="rounded-full border-2 border-white bg-black flex items-center justify-center text-white font-extrabold text-xs shrink-0"
      >
        R&amp;P
      </div>
    );
  }

  return (
    <img
      src="/assets/aistudio/CDACF2E8-55DE-4227-B037-1560D7B15F58_f8edf5f2.png"
      alt="Logo R&P Tabacaria"
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      style={{ width: size, height: size }}
      className="object-contain shrink-0 rounded-full bg-black"
    />
  );
}

export function SafeProductImage({
  src,
  alt,
  className = '',
}: {
  src: string;
  alt: string;
  className?: string;
}) {
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [src]);

  if (!src || errored) {
    return (
      <div
        className={`flex flex-col items-center justify-center bg-gradient-to-br from-[#141414] to-[#0A0A0A] text-[#9E9E9E] ${className}`}
      >
        <Package className="w-8 h-8 mb-2 opacity-60" strokeWidth={1.5} />
        <span className="text-xs font-medium px-3 text-center line-clamp-1">{alt}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      className={className}
    />
  );
}
