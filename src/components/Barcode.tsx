import JsBarcode from 'jsbarcode';
import { useEffect, useRef } from 'react';

interface Props {
  value: string;
  height?: number;
  width?: number;
  fontSize?: number;
  displayValue?: boolean;
}

/** Renderiza un código de barras Code128 a partir del código del ítem */
export function Barcode({
  value,
  height = 54,
  width = 1.7,
  fontSize = 13,
  displayValue = true,
}: Props) {
  const ref = useRef<SVGSVGElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    try {
      JsBarcode(ref.current, value, {
        format: 'CODE128',
        height,
        width,
        fontSize,
        displayValue,
        margin: 6,
        background: '#ffffff',
        lineColor: '#1b1f1a',
        font: 'monospace',
      });
    } catch {
      /* valor inválido */
    }
  }, [value, height, width, fontSize, displayValue]);
  return <svg ref={ref} />;
}
