// IFC GlobalId：22 个字符的压缩 GUID（ISO 16739 附录 A 的 base64 变体字母表）。
//
// 做法：字符串 → 确定性 16 字节 → 132 位左对齐 → 22 个 6 位分组。
// 同一份画面重复导出必须得到同样的 GlobalId，否则每次导出都会被当成新模型。

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'

/** FNV-1a 32 位，用来把任意字符串摊成种子；不用于安全场景。 */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash >>> 0
}

/** xorshift32：确定性伪随机，保证同输入同输出。 */
function nextSeed(seed: number): number {
  let x = seed || 0x9e3779b9
  x ^= x << 13
  x ^= x >>> 17
  x ^= x << 5
  return x >>> 0
}

function bytesOf(key: string): Uint8Array {
  const bytes = new Uint8Array(16)
  let seed = fnv1a(key)
  for (let i = 0; i < 16; i += 4) {
    seed = nextSeed(seed)
    bytes[i] = (seed >>> 24) & 0xff
    bytes[i + 1] = (seed >>> 16) & 0xff
    bytes[i + 2] = (seed >>> 8) & 0xff
    bytes[i + 3] = seed & 0xff
  }
  return bytes
}

/** 16 字节 → IFC 22 字符 GlobalId。 */
export function compressGuid(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new Error('GlobalId 需要 16 字节')
  let value = 0n
  for (let i = 0; i < 16; i += 1) value = (value << 8n) | BigInt(bytes[i] ?? 0)
  value <<= 4n // 128 → 132 位，让 22 个 6 位分组恰好铺满
  const chars: string[] = []
  for (let i = 0; i < 22; i += 1) {
    chars.push(ALPHABET[Number(value & 0x3fn)] ?? '0')
    value >>= 6n
  }
  return chars.reverse().join('')
}

/** 由稳定业务键生成 GlobalId（同一画面/图元重复导出保持一致）。 */
export function guidOf(key: string): string {
  return compressGuid(bytesOf(key))
}
