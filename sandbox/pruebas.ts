// =====================================================================
// BANCO DE PRUEBAS — pruebas automáticas de punta a punta
//
// Desde la consola del banco: `await __banco.pruebas()`.
// Maneja la interfaz como una persona (clicks y tipeo) y después mira la base
// para confirmar que cada carga descontó y registró lo que tenía que registrar.
// Arranca de la base recién cargada: conviene recargar la página antes.
// =====================================================================

type Fila = Record<string, any>;
type Q = (sql: string, params?: unknown[]) => Promise<Fila[]>;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

function modal(): HTMLElement | Document {
  return document.querySelector('.modal') ?? document;
}
function campo(label: string, raiz: ParentNode = modal()): HTMLInputElement | HTMLSelectElement {
  const l = [...raiz.querySelectorAll('label')].find((x) => x.textContent!.trim().startsWith(label));
  const el = l?.parentElement?.querySelector('input,select') as HTMLInputElement | null;
  if (!el) throw new Error(`no encontré el campo "${label}"`);
  return el;
}
function escribir(el: HTMLInputElement | HTMLSelectElement | string, valor: unknown) {
  const e = typeof el === 'string' ? campo(el) : el;
  const proto = e.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(e, String(valor));
  e.dispatchEvent(new Event(e.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }));
}
function click(texto: string, raiz: ParentNode = modal()) {
  const b = [...raiz.querySelectorAll('button')].find((x) => x.textContent!.trim().startsWith(texto));
  if (!b) throw new Error(`no encontré el botón "${texto}"`);
  (b as HTMLButtonElement).click();
}
function clickTitulo(titulo: string) {
  const b = [...document.querySelectorAll('button')].find((x) => x.title === titulo);
  if (!b) throw new Error(`no encontré "${titulo}"`);
  (b as HTMLButtonElement).click();
}
async function ir(seccion: string) {
  const b = [...document.querySelectorAll('.nav__item')].find((x) =>
    x.textContent!.replace(/\d+$/, '').trim().startsWith(seccion)
  );
  if (!b) throw new Error(`no hay sección ${seccion}`);
  (b as HTMLButtonElement).click();
  await esperar(500);
}
const errorModal = () => document.querySelector('.modal .st-agotado')?.textContent ?? null;

export async function correrPruebas(q: Q) {
  const stock = async (cods: string[]) =>
    Object.fromEntries(
      (await q(`select codigo, actual from st_items where codigo = any($1::text[])`, [cods])).map((r) => [r.codigo, Number(r.actual)])
    );
  const ultimo = async () => (await q(`select * from st_movimientos order by fecha desc limit 1`))[0];
  const cantMov = async () => Number((await q(`select count(*)::int n from st_movimientos`))[0].n);
  const resultados: { prueba: string; ok: boolean; detalle: string }[] = [];
  async function prueba(nombre: string, fn: () => Promise<string>) {
    try {
      resultados.push({ prueba: nombre, ok: true, detalle: await fn() });
    } catch (e) {
      resultados.push({ prueba: nombre, ok: false, detalle: (e as Error).message });
      document.querySelector<HTMLButtonElement>('.modal__head .close')?.click();
      await esperar(300);
    }
  }
  const igual = (a: unknown, b: unknown, que: string) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${que}: esperaba ${JSON.stringify(b)}, dio ${JSON.stringify(a)}`);
  };

  async function vender(modo: string, codigo: string, cant: number) {
    await ir('Vender');
    click(modo, document.querySelector('.toolbar .chips')!);
    await esperar(150);
    const inp = document.querySelector('.producto-select input') as HTMLInputElement;
    inp.focus();
    escribir(inp, codigo);
    await esperar(200);
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await esperar(300);
    const c = [...document.querySelectorAll<HTMLInputElement>('.vender-panel input[type=number]')][0];
    escribir(c, cant);
    await esperar(200);
    click('Confirmar', document.querySelector('.vender-panel')!);
    await esperar(1200);
  }

  await prueba('1. Producir 10 de CAP-01 descuenta la receta', async () => {
    const a = await stock(['CAP-01', 'ETQ-CAP-25', 'INS-14', 'MP-04', 'MP-06']);
    await vender('Producción', 'CAP-01', 10);
    const d = await stock(['CAP-01', 'ETQ-CAP-25', 'INS-14', 'MP-04', 'MP-06']);
    igual(d['CAP-01'] - a['CAP-01'], 10, 'producto');
    igual(a['ETQ-CAP-25'] - d['ETQ-CAP-25'], 10, 'etiqueta');
    igual(a['INS-14'] - d['INS-14'], 10, 'bolsa');
    igual(a['MP-04'] - d['MP-04'], 600, 'cápsulas');
    igual(a['MP-06'] - d['MP-06'], 10, 'materia prima');
    igual((await ultimo()).tipo, 'produccion', 'tipo de movimiento');
    return `CAP-01 ${a['CAP-01']}→${d['CAP-01']}; etiqueta −10, bolsa −10, cápsulas −600, MP −10`;
  });

  await prueba('2. Vender 2 de CAP-01 sólo baja el producto', async () => {
    const a = await stock(['CAP-01', 'ETQ-CAP-25', 'MP-04']);
    await vender('Venta', 'CAP-01', 2);
    const d = await stock(['CAP-01', 'ETQ-CAP-25', 'MP-04']);
    igual(a['CAP-01'] - d['CAP-01'], 2, 'producto');
    igual(d['ETQ-CAP-25'], a['ETQ-CAP-25'], 'etiqueta sin tocar');
    igual(d['MP-04'], a['MP-04'], 'cápsulas sin tocar');
    return `CAP-01 ${a['CAP-01']}→${d['CAP-01']}, componentes intactos`;
  });

  await prueba('3. Receta con línea repetida (ACE-03) descuenta una sola vez', async () => {
    const a = await stock(['MP-29']);
    await vender('Producción', 'ACE-03', 3);
    const d = await stock(['MP-29']);
    igual(a['MP-29'] - d['MP-29'], 6, 'pimienta (2 por unidad)');
    const m = await ultimo();
    igual(m.componentes.filter((c: any) => c.codigo === 'MP-29').length, 1, 'líneas de MP-29 en el movimiento');
    return `MP-29 ${a['MP-29']}→${d['MP-29']} en un solo descuento`;
  });

  await prueba('4. Consumo interno descuenta sin ser venta', async () => {
    const a = await stock(['INS-02']);
    await vender('Consumo interno', 'INS-02', 5);
    const d = await stock(['INS-02']);
    igual(a['INS-02'] - d['INS-02'], 5, 'bolsa camiseta');
    igual((await ultimo()).tipo, 'consumo_interno', 'tipo');
    return `INS-02 ${a['INS-02']}→${d['INS-02']}`;
  });

  await prueba('5. Ficha: subir stock con "Se produjo" descuenta la receta', async () => {
    const a = await stock(['CAP-06', 'ETQ-CAP-17', 'MP-X01']);
    await ir('Productos');
    clickTitulo('Editar CAP-06');
    await esperar(400);
    escribir('Stock actual', a['CAP-06'] + 5);
    await esperar(150);
    click('Guardar cambios');
    await esperar(300);
    if (!errorModal()?.includes('Elegí')) throw new Error('guardó sin pedir el motivo');
    click('Se produjo', document.querySelector('.motivo-stock')!);
    await esperar(100);
    click('Guardar cambios');
    await esperar(1500);
    const d = await stock(['CAP-06', 'ETQ-CAP-17', 'MP-X01']);
    igual(d['CAP-06'] - a['CAP-06'], 5, 'producto');
    igual(a['ETQ-CAP-17'] - d['ETQ-CAP-17'], 5, 'etiqueta');
    igual(a['MP-X01'] - d['MP-X01'], 5, 'materia prima');
    igual((await ultimo()).tipo, 'produccion', 'tipo');
    return `sin motivo no guarda; con motivo: producción +5 y receta ×5`;
  });

  await prueba('6. Ficha: conteo físico deja el número exacto', async () => {
    await ir('Productos');
    clickTitulo('Editar EXT-09');
    await esperar(400);
    escribir('Stock actual', 40);
    await esperar(150);
    click('Corrección por conteo', document.querySelector('.motivo-stock')!);
    await esperar(100);
    click('Guardar cambios');
    await esperar(1500);
    igual((await stock(['EXT-09']))['EXT-09'], 40, 'EXT-09');
    igual((await ultimo()).tipo, 'ajuste', 'tipo');
    return 'EXT-09 quedó en 40, movimiento de ajuste';
  });

  await prueba('7. Ingreso con el formulario abierto no pisa lo que cambió la base', async () => {
    await ir('Insumos productos');
    clickTitulo('Editar INS-37');
    await esperar(400);
    const visto = Number((campo('Stock actual') as HTMLInputElement).value);
    await q(`update st_items set actual = actual - 10 where codigo = 'INS-37'`);
    escribir('Stock actual', visto + 20);
    await esperar(150);
    click('Entró mercadería', document.querySelector('.motivo-stock')!);
    await esperar(100);
    click('Guardar');
    await esperar(1500);
    igual((await stock(['INS-37']))['INS-37'], visto - 10 + 20, 'INS-37');
    return `visto ${visto}, la base bajó 10, ingreso +20 → ${visto + 10}`;
  });

  await prueba('8. Cambiar sólo el nombre no toca el stock', async () => {
    await ir('Insumos productos');
    clickTitulo('Editar INS-44');
    await esperar(400);
    await q(`update st_items set actual = actual - 6 where codigo = 'INS-44'`);
    const real = (await stock(['INS-44']))['INS-44'];
    escribir('Nombre', 'Tetina 60 cc (prueba)');
    await esperar(150);
    if (document.querySelector('.motivo-stock')) throw new Error('pidió motivo sin cambiar el stock');
    click('Guardar');
    await esperar(1500);
    igual((await stock(['INS-44']))['INS-44'], real, 'INS-44');
    return `stock real ${real} intacto`;
  });

  await prueba('9. Pedido de la tienda: confirmar, re-guardar y anular', async () => {
    const a = await stock(['CAP-35', 'POL-26', 'CAP-06']);
    const pedido = {
      name: 'Prueba', items: [
        { productId: 'caps-espirulina', presId: '60', qty: 2 },
        { productId: 'polvo-citrato-mag', presId: '100g', qty: 3 },
        { productName: 'Melena de León — Cápsulas — 60u × 500 mg', qty: 1 },
        { productName: 'Cepillo de dientes', qty: 4 },
      ],
    };
    await q(`insert into ss_orders (id, ts, status, data) values ('ORD-T1', 0, 'confirmado', $1::jsonb)`, [JSON.stringify(pedido)]);
    const c = await stock(['CAP-35', 'POL-26', 'CAP-06']);
    igual([a['CAP-35'] - c['CAP-35'], a['POL-26'] - c['POL-26'], a['CAP-06'] - c['CAP-06']], [2, 3, 1], 'descuentos');
    await q(`update ss_orders set data = data where id = 'ORD-T1'`);
    igual(await stock(['CAP-35', 'POL-26', 'CAP-06']), c, 're-guardar no descuenta de nuevo');
    const sm = (await q(`select sin_mapear from st_pedidos where order_id='ORD-T1'`))[0].sin_mapear;
    igual(sm.length, 1, 'líneas sin vincular (el cepillo)');
    await q(`update ss_orders set status = 'anulado' where id = 'ORD-T1'`);
    igual(await stock(['CAP-35', 'POL-26', 'CAP-06']), a, 'anular devuelve todo');
    return 'descuenta Espirulina, Citrato 100 g y la línea por descripción; no duplica; anular devuelve';
  });

  await prueba('10. Renombrar etiqueta usada en receta', async () => {
    const a = await stock(['ETQ-CAP-25']);
    await ir('Etiquetas');
    clickTitulo('Editar ETQ-CAP-25');
    await esperar(400);
    escribir('Código', 'ETQ-CAP-25B');
    await esperar(150);
    click('Guardar');
    await esperar(2000);
    igual((await stock(['ETQ-CAP-25B']))['ETQ-CAP-25B'], a['ETQ-CAP-25'], 'stock conservado');
    const bom = (await q(`select data->'bom' b from st_items where codigo='CAP-01'`))[0].b;
    if (!bom.some((b: any) => b.codigo === 'ETQ-CAP-25B')) throw new Error('la receta de CAP-01 no se actualizó');
    return 'stock conservado y receta de CAP-01 actualizada';
  });

  await prueba('11. Renombrar producto vinculado a la tienda', async () => {
    await q(`insert into ss_orders (id, ts, status, data) values ('ORD-T2', 0, 'confirmado', $1::jsonb)`,
      [JSON.stringify({ name: 'P2', items: [{ productId: 'caps-espirulina', presId: '60', qty: 1 }] })]);
    click('Actualizar', document);
    await esperar(1200);
    const a = await stock(['CAP-35']);
    await ir('Productos');
    clickTitulo('Editar CAP-35');
    await esperar(400);
    escribir('Código', 'CAP-35E');
    await esperar(150);
    click('Guardar cambios');
    await esperar(2500);
    igual((await stock(['CAP-35E']))['CAP-35E'], a['CAP-35'], 'stock conservado');
    igual((await q(`select codigo from st_sku_map where producto_id='caps-espirulina'`))[0].codigo, 'CAP-35E', 'vínculo tienda');
    await q(`update ss_orders set status='anulado' where id='ORD-T2'`);
    igual((await stock(['CAP-35E']))['CAP-35E'], a['CAP-35'] + 1, 'anular devuelve al código nuevo');
    return 'stock, vínculo y pedido viejo siguen al código nuevo';
  });

  await prueba('12. Altas: códigos inválidos y carga simultánea', async () => {
    await ir('Etiquetas');
    click('Nuevo', document);
    await esperar(400);
    click('A mano');
    await esperar(150);
    escribir('Nombre', 'Prueba');
    escribir('Código', 'ETQ PRUEBA');
    click('Crear');
    await esperar(300);
    if (!errorModal()?.includes('espacios')) throw new Error('aceptó un código con espacios');
    escribir('Código', 'ETQ.CAP-25B');
    click('Crear');
    await esperar(300);
    if (!errorModal()?.includes('se lee igual')) throw new Error('aceptó un código repetido');
    escribir('Código', 'ETQ-T-02');
    escribir('Stock actual', 5);
    await q(`insert into st_items (categoria, codigo, nombre, actual) values ('etiqueta','ETQ-T-02','De otra persona',80)`);
    click('Crear');
    await esperar(1200);
    if (!errorModal()?.includes('Ya existe')) throw new Error('no avisó la carga simultánea');
    const f = (await q(`select nombre, actual from st_items where codigo='ETQ-T-02'`))[0];
    igual([f.nombre, Number(f.actual)], ['De otra persona', 80], 'no pisó la carga ajena');
    click('Cancelar');
    await esperar(300);
    return 'bloquea espacios y repetidos; la carga simultánea no pisa';
  });

  await prueba('13. Pasar materia prima a gramos y producir', async () => {
    await ir('Conteo materia');
    const fila = [...document.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('.codigo')?.textContent === 'MP-10')!;
    (([...fila.querySelectorAll('button')].find((b) => b.textContent!.includes('Contar'))) as HTMLButtonElement).click();
    await esperar(500);
    escribir('Contado', 4800);
    click('Completar');
    await esperar(200);
    click('Guardar conteo');
    await esperar(2500);
    const mp = (await q(`select actual, data->>'unidad' u from st_items where codigo='MP-10'`))[0];
    igual([Number(mp.actual), mp.u], [4800, 'g'], 'MP-10');
    await vender('Producción', 'POL-26', 2);
    igual((await stock(['MP-10']))['MP-10'], 4600, 'MP-10 tras producir 2 × 100 g');
    return '4.800 g contados; producir 2 bolsas de 100 g descontó 200 g';
  });

  await prueba('14. Pasar a gramos sin todos los datos no guarda nada', async () => {
    const n = await cantMov();
    await ir('Conteo materia');
    const fila = [...document.querySelectorAll('tbody tr')].find((tr) => tr.querySelector('.codigo')?.textContent === 'MP-06')!;
    (([...fila.querySelectorAll('button')].find((b) => b.textContent!.includes('Contar'))) as HTMLButtonElement).click();
    await esperar(500);
    escribir('Contado', 12000);
    click('Completar');
    await esperar(200);
    click('Guardar conteo');
    await esperar(600);
    if (!errorModal()?.includes('Falta')) throw new Error('guardó sin los gramos de extractos/mezclas');
    igual(await cantMov(), n, 'movimientos nuevos');
    click('Cancelar');
    await esperar(300);
    return 'frena y no escribe';
  });

  await prueba('15. Modal rápido: no acepta cantidades inválidas', async () => {
    await ir('Etiquetas');
    ([...document.querySelectorAll('td.nombre button')][0] as HTMLButtonElement).click();
    await esperar(400);
    const inp = document.querySelectorAll<HTMLInputElement>('.modal input[type=number]')[0];
    const sumar = [...document.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent!.includes('Sumar'))!;
    const estados: string[] = [];
    for (const v of ['', '0', '-5']) {
      escribir(inp, v);
      await esperar(80);
      estados.push(sumar.disabled ? 'bloq' : 'HABILITADO');
    }
    click('Cerrar');
    await esperar(300);
    if (estados.includes('HABILITADO')) throw new Error(`vacío/0/negativo: ${estados.join(',')}`);
    return 'vacío, 0 y negativo bloqueados';
  });

  await prueba('16. Eliminar etiqueta usada en receta la saca de la receta', async () => {
    await ir('Etiquetas');
    clickTitulo('Eliminar ETQ-POL-38');
    await esperar(700);
    click('Eliminar definitivamente');
    await esperar(2000);
    igual((await q(`select count(*)::int n from st_items where codigo='ETQ-POL-38'`))[0].n, 0, 'etiqueta borrada');
    const bom = (await q(`select data->'bom' b from st_items where codigo='POL-37'`))[0].b;
    if (bom.some((b: any) => b.codigo === 'ETQ-POL-38')) throw new Error('quedó en la receta de POL-37');
    return 'borrada y quitada de POL-37';
  });

  const ok = resultados.filter((r) => r.ok).length;
  return { resumen: `${ok} de ${resultados.length} pruebas OK`, resultados };
}

/** Recorre todas las secciones y mide si algo se sale de la pantalla (en el ancho actual) */
export async function revisarPantallas() {
  const res: Record<string, string> = {};
  for (const b of [...document.querySelectorAll<HTMLButtonElement>('.nav__item')]) {
    const v = b.textContent!.replace(/\d+$/, '').trim();
    b.click();
    await esperar(500);
    const pagina = document.documentElement.scrollWidth <= document.documentElement.clientWidth;
    const tablas = [...document.querySelectorAll<HTMLElement>('.content .table-wrap')].every((w) => w.scrollWidth <= w.clientWidth + 1);
    res[v] = pagina && tablas ? 'entra' : `SE SALE (página ${pagina ? 'ok' : 'no'}, tablas ${tablas ? 'ok' : 'no'})`;
  }
  return { ancho: innerWidth, res };
}
