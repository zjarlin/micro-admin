// DWG 读取器：把字节喂给 libredwg 的 WASM，产出与 DXF 同形状的 `CadDrawing`。
//
// **这个文件是唯一接触 GPL 依赖的地方**，并且是**可选**的：
// - `@mlightcad/libredwg-web` 在 `optionalDependencies` 里，没装时 `import()` 失败，
//   调用方（服务端）会把错误翻成「DWG 解析组件未安装」这种可读提示，DXF 链路不受影响；
// - 只在**真正遇到 .dwg** 时才加载：模块顶上是惰性的，wasm（11MB）不进主包、不拖慢冷启动。
//
// 为什么不用它的 `dwg_write_dxf` 再走 DXF 解析：那个函数在这个 wasm 构建里是坏的
// （实测抛 `null function or function signature mismatch`），所以直接吃 `convert()`
// 出来的 `DwgDatabase`，用 `dwgToDrawing()` 适配，下游一条代码。
import type { CadDrawing } from './types.ts'
import { dwgToDrawing, type DwgDatabaseLike, type DwgVersionLike } from './dwg.ts'

/** 库里 `Dwg_File_Type` 的枚举值（不引它的类型，避免可选依赖进类型面）。 */
const DWG_FILE_TYPE = 0

interface LibreDwgModule {
  dwg_read_data: (content: Uint8Array, fileType: number) => unknown
  dwg_get_version_type: (data: unknown) => DwgVersionLike
  convert: (data: unknown) => DwgDatabaseLike
  dwg_free: (data: unknown) => void
}

interface LibreDwgPackage {
  LibreDwg: { create: () => Promise<LibreDwgModule> }
}

/** 只创建一次 wasm 实例：`create()` 要 60~80ms、常驻内存 180MB 级，按请求新建没有意义。 */
let pending: Promise<LibreDwgModule> | null = null

async function loadLibreDwg(): Promise<LibreDwgModule> {
  pending ??= (async () => {
    let pkg: LibreDwgPackage
    try {
      pkg = (await import('@mlightcad/libredwg-web')) as unknown as LibreDwgPackage
    } catch (error) {
      throw new Error(`DWG 解析组件未安装（可选依赖 @mlightcad/libredwg-web）：${error instanceof Error ? error.message : String(error)}`)
    }
    // 不传路径：让 Emscripten 自己按 `import.meta.url` 找同目录的 wasm，
    // 写死宿主路径会在容器里失效（本地能跑、线上报「找不到 .wasm」）。
    return pkg.LibreDwg.create()
  })()
  try {
    return await pending
  } catch (error) {
    // 失败不要留一个永久的 rejected promise，下次请求还能重试（比如刚补装依赖）。
    pending = null
    throw error
  }
}

/**
 * 读一份 DWG 字节 → 图纸。
 *
 * 库内部会把每个版本支持的实体差异处理掉，这里只做「读完就释放」：
 * `dwg_read_data` 在 wasm 堆里分配的对象必须 `dwg_free`，否则大图纸连续导入会涨内存。
 */
export async function parseDwg(bytes: Uint8Array): Promise<CadDrawing> {
  const libredwg = await loadLibreDwg()
  const data = libredwg.dwg_read_data(bytes, DWG_FILE_TYPE)
  if (data === undefined) throw new Error('DWG 解析失败：文件可能损坏，或版本不受 libredwg 支持（R13 之前/加密图纸）')
  try {
    const version = libredwg.dwg_get_version_type(data)
    // convert() 出来的数据库不再依赖 wasm 里的 Dwg_Data，因此释放后者是安全的。
    const db = libredwg.convert(data)
    return dwgToDrawing(db, version)
  } finally {
    libredwg.dwg_free(data)
  }
}
