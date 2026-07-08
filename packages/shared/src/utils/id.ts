import { customAlphabet } from 'nanoid'

// base58（紛らわしい 0/O/I/l を除外）12桁 ≒ 70bit。docs/11 §2。
const b58 = customAlphabet('123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz', 12)

export type IdPrefix = 'thr' | 'mov' | 'scr' | 'pln' | 'run' | 'rev'

// プレフィックス付き短ID。例: newId('scr') => "scr_3bQf9..."
export const newId = (p: IdPrefix): string => `${p}_${b58()}`
