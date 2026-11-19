# 块内插值真机验收

段落引导：这份文档用于真机验证滚动同步的块内插值行为。三道高代码围栏加两道长段落，视口顶停在块内不同深度时，另一面应落在同一内容的同一比例处。

```javascript
// FENCE-ONE 起点
const fence = []
for (let i = 0; i < 48; i++) fence.push(i * 3 + 1)
console.log(fence.join(','))
// 以下为填充行，撑高围栏块
const a1 = 1,
  a2 = 2,
  a3 = 3,
  a4 = 4,
  a5 = 5
const b1 = a1 + a2,
  b2 = a2 + a3,
  b3 = a3 + a4,
  b4 = a4 + a5
function step1(x) {
  return x * 2 + 1
}
function step2(x) {
  return x * 3 - 2
}
function step3(x) {
  return step1(step2(x))
}
const r1 = step3(10),
  r2 = step3(20),
  r3 = step3(30)
console.log(r1, r2, r3)
const list1 = [r1, r2, r3].map((v) => v * 4)
const list2 = list1.filter((v) => v > 100)
const list3 = list2.reduce((s, v) => s + v, 0)
console.log(list3)
for (const v of list1) console.log('item', v)
for (const v of list2) console.log('big ', v)
const obj1 = { x: 1, y: 2, z: 3 }
const obj2 = { ...obj1, w: 4 }
console.log(obj2)
const fn1 = () => obj2.x + obj2.y + obj2.z + obj2.w
const fn2 = () => fn1() * 10
console.log(fn2())
class Demo1 {
  constructor(a) {
    this.a = a
  }
  run() {
    return this.a * 2
  }
}
class Demo2 extends Demo1 {
  run() {
    return super.run() + 1
  }
}
const d1 = new Demo1(5),
  d2 = new Demo2(7)
console.log(d1.run(), d2.run())
const set1 = new Set([1, 2, 3, 3, 4])
const map1 = new Map([
  [1, 'a'],
  [2, 'b']
])
console.log(set1.size, map1.get(2))
try {
  JSON.parse('{bad}')
} catch (e) {
  console.log('caught')
}
const p1 = Promise.resolve(1)
p1.then((v) => console.log('resolved', v))
const gen1 = function* () {
  yield 1
  yield 2
  yield 3
}
for (const v of gen1()) console.log('gen', v)
const sym1 = Symbol('s')
const rec1 = { [sym1]: 'value' }
console.log(rec1[sym1])
const str1 = 'hello world'.toUpperCase()
console.log(str1)
const num1 = Number.parseFloat('3.14')
console.log(num1)
const arr1 = Array.from({ length: 5 }, (_, i) => i * i)
console.log(arr1)
console.log('FENCE-ONE 结束行')
```

段落甲：这是一个故意拉长的段落，用来验证两侧换行宽度不同时块内比例对齐的手感。它包含很多重复的句子，每一句都在讲同一件事：滚动同步的目标是文档位置而不是像素位置，块内按行进度做比例映射，两侧块高不同也无所谓，块界永远不错位。句子继续：第一，锚是归一化后的行位；第二，实现算子把行位换到各自的像素；第三，读出算子把像素换回行位；第四，两者互逆。句子继续：因此在窄栏里这个段落会换更多的行、块更高，比例对齐会把视口顶落在内容进度大致相同的地方。句子继续：这就是数学模型所说的投影对齐，块界精确、块内近似。

```javascript
// FENCE-TWO 起点
const fence2 = []
for (let i = 0; i < 48; i++) fence2.push(i * 7 + 2)
console.log(fence2.join(','))
// 以下为填充行，撑高围栏块
const c1 = 10,
  c2 = 20,
  c3 = 30,
  c4 = 40,
  c5 = 50
const e1 = c1 * c2,
  e2 = c2 * c3,
  e3 = c3 * c4,
  e4 = c4 * c5
function walk1(n) {
  return n <= 1 ? 1 : n * walk1(n - 1)
}
function walk2(n) {
  return n <= 0 ? 0 : n + walk2(n - 1)
}
console.log(walk1(6), walk2(10))
const memo = new Map()
function fib(n) {
  if (memo.has(n)) return memo.get(n)
  const v = n < 2 ? n : fib(n - 1) + fib(n - 2)
  memo.set(n, v)
  return v
}
console.log(fib(30))
const tree1 = { v: 1, l: { v: 2 }, r: { v: 3, l: { v: 4 }, r: { v: 5 } } }
function sumTree(t) {
  return !t ? 0 : t.v + sumTree(t.l) + sumTree(t.r)
}
console.log(sumTree(tree1))
function depth(t) {
  return !t ? 0 : 1 + Math.max(depth(t.l), depth(t.r))
}
console.log(depth(tree1))
const flat1 = [1, [2, [3, [4]]]].flat(Infinity)
console.log(flat1)
const group1 = Object.groupBy(flat1, (v) => (v % 2 === 0 ? 'even' : 'odd'))
console.log(group1)
const sorted1 = flat1.sort((a, b) => b - a)
console.log(sorted1)
const str2 = flat1.join(' -> ')
console.log(str2)
const reg1 = /(\d+)-(\d+)/g
const ms1 = '12-34 56-78'.matchAll(reg1)
for (const m of ms1) console.log(m[1], m[2])
const enc1 = Buffer.from ? 'node' : 'browser'
console.log(enc1)
const date1 = new Date(2026, 10, 20)
console.log(date1.getFullYear())
const math1 = Math.hypot(3, 4)
console.log(math1)
const rnd1 = [Math.random(), Math.random(), Math.random()]
console.log(rnd1.length)
const deep1 = JSON.parse(JSON.stringify({ a: { b: { c: 1 } } }))
console.log(deep1.a.b.c)
const proxy1 = new Proxy({}, { get: () => 42 })
console.log(proxy1.anything)
const wk1 = new WeakMap()
console.log('FENCE-TWO 结束行')
```

段落乙：第二个长段落，与段落甲同样拉长，用于第二次块内比例测量。内容继续重复同一主题：跟随的平滑性来自把目标从块顶细化到块内行进度，读者在长块中部滚动时另一面不再跳回块顶。句子继续：本视图的单位就是源码行，CodeMirror 逐行有精确坐标，所以行位在这里无损；文与栏的块内没有逐行坐标，就按行数比例估。句子继续：这是模型里最细的可迁移粒度，再细就跨不过两侧不同的排版。句子继续：晚到的图片只改几何不改换算，结构版本化几何活读两条纪律保证账目不漂。

```javascript
// FENCE-THREE 起点
const fence3 = []
for (let i = 0; i < 48; i++) fence3.push(i * 11 + 3)
console.log(fence3.join(','))
// 以下为填充行，撑高围栏块
const f1 = 'F',
  f2 = 'E',
  f3 = 'N',
  f4 = 'C',
  f5 = 'E'
console.log(f1 + f2 + f3 + f4 + f5)
const slice1 = [1, 2, 3, 4, 5].slice(1, 4)
console.log(slice1)
const splice1 = [1, 2, 3]
splice1.splice(1, 0, 99)
console.log(splice1)
const concat1 = [1].concat([2], [3])
console.log(concat1)
const join1 = concat1.join('+')
console.log(join1)
const reverse1 = [...concat1].reverse()
console.log(reverse1)
const find1 = concat1.find((v) => v > 1)
console.log(find1)
const some1 = concat1.some((v) => v > 2)
console.log(some1)
const every1 = concat1.every((v) => v > 0)
console.log(every1)
const push1 = []
push1.push(1, 2, 3)
console.log(push1)
const pop1 = push1.pop()
console.log(pop1, push1)
const shift1 = push1.shift()
console.log(shift1, push1)
const unshift1 = push1.unshift(0)
console.log(unshift1, push1)
const sort1 = [3, 1, 2].sort()
console.log(sort1)
const keys1 = Object.keys({ a: 1, b: 2 })
console.log(keys1)
const values1 = Object.values({ a: 1, b: 2 })
console.log(values1)
const entries1 = Object.entries({ a: 1, b: 2 })
console.log(entries1)
const freeze1 = Object.freeze({ x: 1 })
console.log(Object.isFrozen(freeze1))
console.log('FENCE-THREE 结束行')
```

收尾段落：验收结束。若视口顶停在围栏中段时另一面也落在中段而不是跳回块顶，块内插值即为生效。

<!-- begin 60:40 -->

分栏甲：这一小节只为了让「栏」叶出现在切换器里（hasColumns 判据）。甲栏这一句话内容很短，不参与上方的块内测量。

<!-- split -->

分栏乙：右栏这一句是乙的第一句。正文的三道高围栏与两个长段落都在本分栏组之外，块内插值测量不受本组影响；同时本组让 flow 与 columns 两个域的顶层块序天然错开（标记块可见性差异），跟随必须走行位换算而非块序直通——这正是 §6.0 要看守的跨域形态。

<!-- end -->
