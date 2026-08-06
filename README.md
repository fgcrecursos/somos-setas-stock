# Somos Setas · Control de Stock

Plataforma web de gestión de inventario para [Somos Setas](https://somossetas.com.ar) — suplementos naturales a base de hongos adaptógenos.

![Version](https://img.shields.io/badge/version-1.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![React](https://img.shields.io/badge/react-19-blue)
![TypeScript](https://img.shields.io/badge/typescript-5-blue)

## ✨ Características

### Acceso y permisos
- **Login con cuenta propia**: la misma cuenta de Supabase que usa el panel de la tienda
- **Dos niveles**: *acceso total* (carga, edita, vende, ajusta) y *solo lectura* (mira todo, no toca nada)
- **Alta de usuarios desde la app**: crear el acceso y asignar el permiso, sin entrar a Supabase
- **Cada movimiento queda firmado** con el email de quien lo hizo

### Dashboard
- **KPIs en tiempo real**: total de ítems, stock bajo mínimo, productos agotados, producción requerida
- **Alertas de reposición**: tabla filtrable de ítems por debajo del mínimo con diferencia visual
- **Estado de stock**: indicadores por categoría (Productos, Insumos, Etiquetas, Materia prima)

### Gestión de Stock Vinculado (BOM)
- **Recetas automáticas**: cada producto vincula su etiqueta + envases + materia prima
- **Descuento en cascada**: al vender/producir, se descuentan automáticamente todos los componentes
- **Editor de receta**: formulario integrado para definir qué necesita cada producto

### Vender / Producir
- **Escaneo de código de barras**: cámara en tiempo real (`@zxing/library`) o ingreso manual
- **Preview de descuento**: visualiza antes de confirmar cuántos componentes se descuentan
- **Dos modos**: Venta (descuenta producto) o Producción (suma producto, consume insumos)
- **Generación de códigos**: imprime Code128 de cada ítem

### Inventario por Categoría
- **5 vistas** (Productos, Insumos, Insumos internos, Etiquetas, Materia prima)
- **Búsqueda y filtros**: por código, nombre, solo items con faltantes
- **Tabla ordenable**: click en encabezados para ordenar por cualquier columna
- **Acciones rápidas**: ver código de barras, ingresar stock, ajustar cantidad

### Ventas
- **Conteo de productos vendidos**: unidades por producto, con filtros por período (mes, año, histórico)
- **Ranking con participación**: qué se vende y cuánto pesa cada producto sobre el total
- **Vista de producción**: el mismo informe para lo que se fabricó
- **Informe descargable** en Excel

### Historial
- **Movimientos detallados**: cada venta/producción queda registrada con componentes descontados
- **Expandible**: haz click en un movimiento para ver el desglose de consumos
- **Quién lo hizo**: cada movimiento guarda el usuario que lo registró

### Backup
- **Un botón, un Excel**: inventario completo, recetas, historial, consumos y ventas por producto,
  cada cosa en su hoja

## 🚀 Quick Start

```bash
# Clonar
git clone https://github.com/fgcrecursos/somos-setas-stock.git
cd somos-setas-stock

# Instalar dependencias
npm install

# Iniciar dev server (puerto 5183)
npm run dev

# Build para producción
npm run build
```

Luego abre **http://localhost:5183**

## 📦 Stack

- **Frontend**: React 19 + TypeScript
- **Build**: Vite
- **Backend**: Supabase (Postgres + Auth), el mismo proyecto que la tienda
- **Estado**: Context API sobre la base; cada cambio viaja a la nube al instante
- **Escaneo**: @zxing/library
- **Códigos de barras**: jsbarcode
- **Excel**: SheetJS (se carga sólo al descargar)
- **UI**: Lucide React (iconos) + CSS puro (diseño auténtico de marca)
- **Tipado**: TypeScript strict

## 💾 Base de datos

Todo vive en Supabase, así que **el equipo trabaja sobre los mismos números** desde cualquier
computadora o celular:

| Tabla | Qué guarda |
|---|---|
| `st_users` | quién entra y con qué permiso (`admin` / `invitado`) |
| `st_items` | el inventario completo, una fila por ítem |
| `st_movimientos` | el historial: ventas, producción, ingresos y ajustes |

Las ventas y los descuentos de receta se aplican con la función `st_aplicar()`, que bloquea las
filas y hace `actual = actual + delta` **dentro de la base**. Por eso dos personas pueden vender
al mismo tiempo sin pisarse el stock.

El semillero original (`src/data/seed.ts`) tiene **104 productos**, **44 insumos**, **19 insumos
internos**, **110 etiquetas** y **57 materias primas**, extraídos del Excel real; se usa sólo para
la carga inicial y para el botón *Restablecer datos*.

> **Nota**: el Excel no traía recetas explícitas, así que se infirieron por nombre/presentación. Las cantidades pueden editarse desde la interfaz para usar valores reales.

## 🔧 Puesta en marcha (una sola vez)

1. **Crear las tablas**: pegar `supabase/stock_schema.sql` en el SQL Editor de Supabase y ejecutarlo.
   Deja creadas las tablas, las políticas de seguridad y los permisos de los tres accesos totales
   más la cuenta de invitado.
2. **Crear las cuentas de acceso**: quien ya entra al panel de la tienda usa el mismo email y
   contraseña. Para el resto, desde la sección **Usuarios** de la app (o en Supabase →
   Authentication → Users).
3. **Cargar el inventario**: entrar como administrador **desde la computadora donde se venía usando
   la app** y elegir *Subir lo de este navegador*. Eso sube los datos con los que se venía
   trabajando; la otra opción arranca del Excel original.

## 🎨 Identidad Visual

- **Colores auténticos**: verde `#1B1F1A` (principal), crema `#F5F0E6`, naranja `#EF7911` (acento)
- **Tipografía**: Oswald (títulos) + Montserrat (cuerpo)
- **Logo real**: descargado desde somossetas.com.ar

## 📋 Cómo funciona el descuento en cascada

1. Seleccionas un producto (Ej. "ACE-06 Menta")
2. La app muestra su **receta**: etiqueta + frasco 30cc + tetina + tapa + inserto + esencia de menta
3. Ingresas la cantidad (Ej. 5 unidades)
4. El preview muestra el descuento: producto 17→12, etiqueta 128→123, frasco 868→863, etc.
5. Confirmas → se registra una venta y **todos** los componentes se descuentan automáticamente

## 🔍 Escaneo de Código de Barras

1. Desde la vista **"Vender / Escanear"**, haz clic en "Iniciar cámara"
2. Apunta el código de barras o QR del producto
3. La app carga automáticamente el producto (vibración háptica opcional)
4. Luego confirma la venta

También puedes:
- Escribir el código manualmente en el campo "Ingreso manual"
- Cambiar entre cámaras si tienes varias
- Generar e imprimir códigos desde la ficha de cada ítem

## 📊 Estructura de Datos

```typescript
// Categorías
type Categoria = 'producto' | 'insumo' | 'insumo_interno' | 'etiqueta' | 'materia_prima'

// Cada ítem tiene
interface BaseItem {
  codigo: string        // Identificador único
  nombre: string
  actual: number        // Stock actual
  minimo: number        // Stock mínimo
}

// Productos incluyen receta
interface Producto extends BaseItem {
  tipo: string          // "Aceite", "Cápsulas", etc.
  presentacion: string  // "Frasco 30cc", "Bolsa 60 u", etc.
  bom: BomItem[]       // Bill of Materials
}

interface BomItem {
  categoria: Categoria
  codigo: string       // Qué necesita
  cantidad: number     // Cuántos/cuánto
}
```

## 🔧 Desarrollo

### Agregar un nuevo componente
```bash
src/components/MyComponent.tsx
```

### Agregar una nueva vista
```bash
src/views/MyView.tsx
```

### Editar datos de seed
Modifica `src/data/seed.ts` o regenera desde el Excel con:
```bash
python scratchpad/gen_seed.py
```

## 🎯 Roadmap

- [ ] Ajustar recetas con datos reales del Excel
- [ ] Vista de "Orden de compra" agrupada por proveedor
- [x] Exportar stock a CSV/Excel
- [x] Historial de movimientos filtrable
- [x] Respaldar en cloud (Supabase)
- [x] Login con roles y usuario invitado

## 📄 Licencia

MIT

## ✉️ Contacto

Frani · fngc279@gmail.com

---

**Somos Setas** — Hongos Adaptógenos y Suplementos Naturales  
[somossetas.com.ar](https://somossetas.com.ar)
