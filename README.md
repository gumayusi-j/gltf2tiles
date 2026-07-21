# gltf2tiles

Convert GLB/glTF to **3D Tiles 1.1** with spatial partitioning, LOD, and compression.

```bash
npm install -g gltf2tiles
gltf2tiles -i model.glb -o ./tiles
```

---

## 1. 快速开始

### 安装

```bash
# 从 npm 安装
npm install -g gltf2tiles

# 从本地开发版安装
cd D:\gltf2tiles
npm install -g .
```

### 最小使用

```bash
gltf2tiles -i model.glb -o ./output
```

输出：
```
output/
├── tileset.json
├── 0.glb
└── ...
```

### 完整功能

```bash
gltf2tiles -i city.glb -o ./output \
  --max-items 500 \
  --max-depth 8 \
  --lod-levels 3 \
  --simplify-ratio 0.5 \
  --simplify-error 0.01 \
  --draco \
  --lon 120.0 --lat 30.0 --alt 0 \
  --implicit
```

---

## 2. 开发模式

```bash
cd D:\gltf2tiles
npm install
npm run build
npm test
npm link
gltf2tiles -i model.glb -o /tmp/test-output
npm unlink -g gltf2tiles
```

---

## 3. CLI 参数参考

| 参数 | 说明 | 默认值 |
|---|---|---|
| `-i, --input <path>` | 输入 GLB/glTF 文件 | **(必填)** |
| `-o, --output <dir>` | 输出目录 | **(必填)** |
| `--max-items <n>` | 每瓦片最大实例数 | `1000` |
| `--max-depth <n>` | 八叉树最大深度 | `8` |
| `--lon <deg>` | 中心经度 | 不使用 |
| `--lat <deg>` | 中心纬度 | 不使用 |
| `--alt <m>` | 中心海拔 | `0` |
| `--lod-levels <n>` | LOD 层级数 | `1` |
| `--simplify-ratio <r>` | 简化比 | `0.5` |
| `--simplify-error <e>` | 简化最大误差 | `0.01` |
| `--implicit` | 启用 3D Tiles 1.1 隐式瓦片 | off |
| `--subdivision <s>` | QUADTREE 或 OCTREE | `OCTREE` |
| `--subtree-levels <n>` | subtree 层级 | `5` |
| `--draco` | Draco 网格压缩 | off |
| `--ktx2` | KTX2 纹理压缩 | off |
| `-v, --verbose` | 详细日志 | off |

---

## 4. 输出结构

### 显式模式
```
output/
├── tileset.json
├── 0.glb
├── 0_0.glb
└── 0_1.glb
```

### LOD 模式
```
output/
├── tileset.json
├── 0_lod0.glb   原始网格
├── 0_lod1.glb   50% 简化
└── 0_lod2.glb   25% 简化
```

### 隐式模式
```
output/
├── tileset.json
├── {level}/{x}/{y}.glb
└── subtrees/
    └── 0/0/0.subtree
```

---

## 5. 打包发布

```bash
npm pack
npm login
npm publish
npx pkg dist/cli.js --targets node18-win-x64 --output gltf2tiles.exe
```

---

## 项目结构

```
src/
├── cli.ts                  CLI 入口
├── index.ts                主管线编排
├── types.ts                类型定义
├── constants.ts            常量
├── coord/transform.ts      坐标转换
├── glb/reader.ts           GLB 读取
├── glb/writer.ts           瓦片输出 + 压缩
├── scene/flatten.ts        场景图扁平化
├── spatial/bbox.ts         包围盒运算
├── spatial/octree.ts       八叉树分割
├── lod/generator.ts        LOD 生成
└── tileset/
    ├── tileset-1.1.ts      tileset.json
    ├── explicit.ts         显式瓦片
    └── implicit.ts         隐式 tiling
```
