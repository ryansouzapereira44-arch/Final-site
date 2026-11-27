export async function compressImageFileToDataUrl(
  file: File,
  maxDimension = 1600,
  quality = 0.84
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione um arquivo de imagem válido (JPG, PNG ou WebP).');
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error('A foto selecionada é muito grande (máximo 15 MB).');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Não foi possível abrir a foto selecionada.'));
      el.src = objectUrl;
    });

    const srcWidth = img.naturalWidth || img.width;
    const srcHeight = img.naturalHeight || img.height;
    if (!srcWidth || !srcHeight) {
      throw new Error('Dimensões inválidas na imagem selecionada.');
    }

    const scale = Math.min(1, maxDimension / Math.max(srcWidth, srcHeight));
    const targetWidth = Math.max(1, Math.round(srcWidth * scale));
    const targetHeight = Math.max(1, Math.round(srcHeight * scale));

    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Não foi possível processar a imagem neste dispositivo.');
    }

    ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

    const outputType = file.type === 'image/png' && file.size <= 1.2 * 1024 * 1024
      ? 'image/png'
      : 'image/jpeg';

    return canvas.toDataURL(outputType, quality);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
