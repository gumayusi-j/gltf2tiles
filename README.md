# gltf2tiles

Convert GLB/glTF to **3D Tiles 1.1** with spatial partitioning, LOD, and compression.

## 安装使用

**方式一：.tgz 包（需要 Node.js 18+）**

```bash
# 解压
tar -xzf gltf2tiles-0.2.0.tgz

# 直接运行
node package/dist/cli.js -i model.glb -o ./output

# 或全局安装
npm install -g ./gltf2tiles-0.2.0.tgz
gltf2tiles -i model.glb -o ./output
```

## CLI 参数

| 参数 | 说明 | 默认值 |
|---|---|---|
| `-i, --input <path>` | 输入 GLB/glTF 文件 | **(必填)** |
| `-o, --output <dir>` | 输出目录 | **(必填)** |
| `--max-items <n>` | 每瓦片最大实例数 | `1000` |
| `--max-depth <n>` | 八叉树最大深度 | `8` |
| `--lon <deg>` | 中心经度 | 不使用 |
| `--lat <deg>` | 中心纬度 | 不使用 |
| `--alt <m>` | 中心海拔 | `0` |
| `--lod-levels <n>` | LOD 层级数 | `1` (不生成) |
| `--simplify-ratio <r>` | 简化比 | `0.5` |
| `--simplify-error <e>` | 简化最大误差 | `0.01` |
| `--implicit` | 启用 3D Tiles 1.1 隐式瓦片 | off |
| `--subdivision <s>` | QUADTREE 或 OCTREE | `OCTREE` |
| `--subtree-levels <n>` | subtree 层级 | `5` |
| `--draco` | Draco 网格压缩 | off |
| `--ktx2` | KTX2 纹理压缩（Basis Universal） | off |
| `--ktx2-format <format>` | KTX2 格式: `etc1s` 或 `uastc` | `etc1s` |
| `--ktx2-quality <n>` | 压缩质量 1-255（ETC1S 模式） | `128` |
| `--ktx2-mipmaps` | 生成 mipmap 链 | off |
| `-v, --verbose` | 详细日志 | off |

## 示例

```
gltf2tiles -i model.glb -o ./output
gltf2tiles -i city.glb -o ./output --max-items 500 --lod-levels 3 --draco
gltf2tiles -i model.glb -o ./output --lon 120.0 --lat 30.0 --alt 0 --implicit
gltf2tiles -i scene.glb -o ./output --ktx2 --ktx2-format uastc --ktx2-mipmaps
```

## 输出结构

```
output/
├── tileset.json              3D Tiles 入口
├── 0.glb                     瓦片 0
├── 0_0.glb                   瓦片 0_0
├── 0_lod0.glb                最精细 LOD
├── 0_lod1.glb                中等 LOD
├── 0_lod2.glb                最粗略 LOD
└── subtrees/                 隐式模式
    └── 0/0/0.subtree
```

---

灵感与部分算法参考自 [fanvanzh/3dtiles](https://github.com/fanvanzh/3dtiles) —— 一个高性能的 Rust/C++ 混合架构 3D Tiles 转换工具。

## License

MIT
