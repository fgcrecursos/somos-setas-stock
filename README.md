# Somos Setas · Control de Stock

Plataforma web de gestión de inventario para [Somos Setas](https://somossetas.com.ar) — suplementos naturales a base de hongos adaptógenos.

![Version](https://img.shields.io/badge/version-1.0.0-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![React](https://img.shields.io/badge/react-18-blue)
![TypeScript](https://img.shields.io/badge/typescript-5-blue)

## ✨ Características

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

### Historial
- **Movimientos detallados**: cada venta/producción queda registrada con componentes descontados
- **Expandible**: haz click en un movimiento para ver el desglose de consumos

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

- **Frontend**: React 18 + TypeScript
- **Build**: Vite
- **Estado**: Context API + localStorage (sin backend)
- **Escaneo**: @zxing/library
- **Códigos de barras**: jsbarcode
- **UI**: Lucide React (iconos) + CSS puro (diseño auténtico de marca)
- **Tipado**: TypeScript strict

## 💾 Datos

La app carga **104 productos**, **44 insumos**, **19 insumos internos**, **110 etiquetas** y **57 materias primas** desde `src/data/seed.ts` (extraídos del Excel de control de stock real).

**Persistencia local**: todos los cambios se guardan en `localStorage` bajo la key `somos-setas-stock:v1`.

> **Nota**: el Excel no traía recetas explícitas, así que se infirieron por nombre/presentación. Las cantidades pueden editarse desde la interfaz para usar valores reales.

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
- [ ] Exportar stock a CSV/Excel
- [ ] Historial de movimientos filtrable
- [ ] Respaldar en cloud (Supabase)

## 📄 Licencia

MIT

## ✉️ Contacto

Frani · fngc279@gmail.com

---

**Somos Setas** — Hongos Adaptógenos y Suplementos Naturales  
[somossetas.com.ar](https://somossetas.com.ar)
