# dsh-repo-analyzer

> 本地仓库情报：让 Agent 先看懂仓库，再动手改代码。
> Local repository intelligence for DeepSeek Harness: stack detection, dependency maps, and module-reference analysis — no extra services, everything runs on your filesystem.

[![license](https://img.shields.io/badge/license-MIT-blue)](#license) ![api](https://img.shields.io/badge/API-rc.6-8A2BE2) ![tools](https://img.shields.io/badge/tools-3-2ea44f) ![platform](https://img.shields.io/badge/node-22%2B-339933)

## 这是什么 / What is this

`dsh-repo-analyzer` 是一个纯本地的仓库分析插件，符合 Harness「一切皆插件」的理念：
不启动额外服务、不调用 LLM、不派生子代理，只用 `node:fs` 在本地文件系统上干活。

- **repo_scan** — 扫描仓库：识别技术栈（manifest 探测）、按扩展名统计文件、列出顶层目录规模。
- **repo_deps** — 解析依赖清单（`package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`），支持查询单个依赖的「声明位置 + 引用它的源文件」（影响面分析）。
- **repo_refs** — 本地模块引用图（启发式 import/require 解析）：找出被引用最多的架构热点模块和跨目录依赖边。

## 特性 / Features

- **零依赖运行时**：只有 `dsh-tools` + `schemastery`，代码全在本地跑，毫秒级返回。
- **安全默认**：路径解析后校验必须落在配置 root 内（防目录穿越）；默认排除 `node_modules` / `.git` / `dist` / 编译产物等；超大文件跳过；`maxFiles` 硬上限。
- **模型友好**：工具直接产出结构化 JSON，模型可以用它做架构理解、变更影响评估、依赖审计、找“该读哪个文件”的起点。

## 安装 / Install

```bash
# 从本地目录安装（会自动链接并写入 profile 的 bundles）
dsh plugin --profile <name> add /path/to/dsh-repo-analyzer

# 或从 npm/GitHub 安装
dsh plugin --profile <name> add dsh-repo-analyzer
```

## 配置 / Configuration

```yaml
- insert:
    - id: dsh-repo-analyzer
      name: dsh-repo-analyzer
      config:
        root: '.'            # 仓库根，相对 agent 的 cwd
        maxDepth: 4          # 最大遍历深度
        maxFiles: 20000      # 单次分析文件数上限
        maxFileBytes: 1048576
        exclude:             # 跳过名单（默认已含 node_modules/.git/dist 等）
          - node_modules
          - .git
          - lib
```

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `root` | string | `.` | 仓库根，相对 agent 的 cwd |
| `maxDepth` | number | `4` | 目录遍历深度上限（1–20） |
| `maxFiles` | number | `20000` | 单次分析文件数硬上限 |
| `maxFileBytes` | number | `1048576` | 超过该字节数的文件跳过 |
| `exclude` | string[] | 见 schema | 按名称跳过的目录/文件 |

## 工具 / Tools

| 工具 | 参数 | 返回 |
|---|---|---|
| `repo_scan` | `path?` 子目录, `depth?` 覆盖深度 | 技术栈、文件/目录/字节统计、语言分布、顶层目录规模、manifests |
| `repo_deps` | `package?` 依赖名 | 各 manifest 的依赖列表 + 总量；传 `package` 时返回声明位置与引用它的源文件 |
| `repo_refs` | `maxEdges?` 默认 20 | 引用图统计、被引用最多的本地模块（热点）、跨目录依赖边 |

## 用法 / Usage

```text
先 repo_scan 看仓库概览 → 再 repo_deps 看依赖 → 最后 repo_refs 找架构热点，
然后告诉我这个仓库的模块划分和最容易踩雷的地方。
```

```text
repo_deps 查一下 lodash 被哪些文件引用，评估删掉它的影响面。
```

## 实现说明 / Implementation notes

- **技术栈识别**：按 manifest 文件存在性探测（`package.json`/`pyproject.toml`/`go.mod`/`Cargo.toml` 等）。
- **依赖解析**：`package.json` 用 JSON.parse；`pyproject.toml` / `go.mod` / `Cargo.toml` 用启发式子集解析，异常清单会安全跳过。
- **引用图**：对 `.ts/.tsx/.js/.jsx/.mjs/.cjs/.py` 做 import/require 正则扫描，解析本地相对引用并规范化为文件路径，按目录聚合边。**启发式而非 AST 精确**——用于架构概览足够，别拿它当静态分析器的依据。
- **安全**：所有用户输入路径经 `resolveWithin` 校验（必须落在 root 内）；符号链接文件会 `stat` 后按真实文件处理。

## 开发 / Development

```bash
npm install
npm run build   # tsc -> lib/
```

本地验证（使用复制出的 profile）：

```bash
cp -r ~/.dsh/profiles/headless ~/.dsh/profiles/analyze-test
dsh plugin --profile analyze-test add /path/to/dsh-repo-analyzer
dsh --profile analyze-test --dump-config      # 确认补丁生效
dsh --profile analyze-test "用 repo_scan 分析这个仓库的技术栈"
```

## License

MIT