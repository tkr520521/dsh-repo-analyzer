# dsh-repo-analyzer

> 鏈湴浠撳簱鎯呮姤锛氳 Agent 鍏堢湅鎳備粨搴擄紝鍐嶅姩鎵嬫敼浠ｇ爜銆?> Local repository intelligence for DeepSeek Harness: stack detection, dependency maps, and module-reference analysis 鈥?no extra services, everything runs on your filesystem.

[![license](https://img.shields.io/badge/license-MIT-blue)](#license) ![api](https://img.shields.io/badge/API-rc.6-8A2BE2) ![tools](https://img.shields.io/badge/tools-3-2ea44f) ![platform](https://img.shields.io/badge/node-22%2B-339933)

## 杩欐槸浠€涔?/ What is this

`dsh-repo-analyzer` 鏄竴涓函鏈湴鐨勪粨搴撳垎鏋愭彃浠讹紝绗﹀悎 Harness銆屼竴鍒囩殕鎻掍欢銆嶇殑鐞嗗康锛?涓嶅惎鍔ㄩ澶栨湇鍔°€佷笉璋冪敤 LLM銆佷笉娲剧敓瀛愪唬鐞嗭紝鍙敤 `node:fs` 鍦ㄦ湰鍦版枃浠剁郴缁熶笂骞叉椿銆?
- **repo_scan** 鈥?鎵弿浠撳簱锛氳瘑鍒妧鏈爤锛坢anifest 鎺㈡祴锛夈€佹寜鎵╁睍鍚嶇粺璁℃枃浠躲€佸垪鍑洪《灞傜洰褰曡妯°€?- **repo_deps** 鈥?瑙ｆ瀽渚濊禆娓呭崟锛坄package.json` / `pyproject.toml` / `go.mod` / `Cargo.toml`锛夛紝鏀寔鏌ヨ鍗曚釜渚濊禆鐨勩€屽０鏄庝綅缃?+ 寮曠敤瀹冪殑婧愭枃浠躲€嶏紙褰卞搷闈㈠垎鏋愶級銆?- **repo_refs** 鈥?鏈湴妯″潡寮曠敤鍥撅紙鍚彂寮?import/require 瑙ｆ瀽锛夛細鎵惧嚭琚紩鐢ㄦ渶澶氱殑鏋舵瀯鐑偣妯″潡鍜岃法鐩綍渚濊禆杈广€?
## 鐗规€?/ Features

- **闆朵緷璧栬繍琛屾椂**锛氬彧鏈?`dsh-tools` + `schemastery`锛屼唬鐮佸叏鍦ㄦ湰鍦拌窇锛屾绉掔骇杩斿洖銆?- **瀹夊叏榛樿**锛氳矾寰勮В鏋愬悗鏍￠獙蹇呴』钀藉湪閰嶇疆 root 鍐咃紙闃茬洰褰曠┛瓒婏級锛涢粯璁ゆ帓闄?`node_modules` / `.git` / `dist` / 缂栬瘧浜х墿绛夛紱瓒呭ぇ鏂囦欢璺宠繃锛沗maxFiles` 纭笂闄愩€?- **妯″瀷鍙嬪ソ**锛氬伐鍏风洿鎺ヤ骇鍑虹粨鏋勫寲 JSON锛屾ā鍨嬪彲浠ョ敤瀹冨仛鏋舵瀯鐞嗚В銆佸彉鏇村奖鍝嶈瘎浼般€佷緷璧栧璁°€佹壘鈥滆璇诲摢涓枃浠垛€濈殑璧风偣銆?
## 瀹夎 / Install

```bash
# 浠庢湰鍦扮洰褰曞畨瑁咃紙浼氳嚜鍔ㄩ摼鎺ュ苟鍐欏叆 profile 鐨?bundles锛?dsh plugin --profile <name> add /path/to/dsh-repo-analyzer

# 鎴栦粠 npm/GitHub 瀹夎
dsh plugin --profile <name> add dsh-repo-analyzer
```

## 閰嶇疆 / Configuration

```yaml
- insert:
    - id: dsh-repo-analyzer
      name: dsh-repo-analyzer
      config:
        root: '.'            # 浠撳簱鏍癸紝鐩稿 agent 鐨?cwd
        maxDepth: 4          # 鏈€澶ч亶鍘嗘繁搴?        maxFiles: 20000      # 鍗曟鍒嗘瀽鏂囦欢鏁颁笂闄?        maxFileBytes: 1048576
        exclude:             # 璺宠繃鍚嶅崟锛堥粯璁ゅ凡鍚?node_modules/.git/dist 绛夛級
          - node_modules
          - .git
          - lib
```

| 瀛楁 | 绫诲瀷 | 榛樿 | 璇存槑 |
|---|---|---|---|
| `root` | string | `.` | 浠撳簱鏍癸紝鐩稿 agent 鐨?cwd |
| `maxDepth` | number | `4` | 鐩綍閬嶅巻娣卞害涓婇檺锛?鈥?0锛?|
| `maxFiles` | number | `20000` | 鍗曟鍒嗘瀽鏂囦欢鏁扮‖涓婇檺 |
| `maxFileBytes` | number | `1048576` | 瓒呰繃璇ュ瓧鑺傛暟鐨勬枃浠惰烦杩?|
| `exclude` | string[] | 瑙?schema | 鎸夊悕绉拌烦杩囩殑鐩綍/鏂囦欢 |

## 宸ュ叿 / Tools

| 宸ュ叿 | 鍙傛暟 | 杩斿洖 |
|---|---|---|
| `repo_scan` | `path?` 瀛愮洰褰? `depth?` 瑕嗙洊娣卞害 | 鎶€鏈爤銆佹枃浠?鐩綍/瀛楄妭缁熻銆佽瑷€鍒嗗竷銆侀《灞傜洰褰曡妯°€乵anifests |
| `repo_deps` | `package?` 渚濊禆鍚?| 鍚?manifest 鐨勪緷璧栧垪琛?+ 鎬婚噺锛涗紶 `package` 鏃惰繑鍥炲０鏄庝綅缃笌寮曠敤瀹冪殑婧愭枃浠?|
| `repo_refs` | `maxEdges?` 榛樿 20 | 寮曠敤鍥剧粺璁°€佽寮曠敤鏈€澶氱殑鏈湴妯″潡锛堢儹鐐癸級銆佽法鐩綍渚濊禆杈?|

## 鐢ㄦ硶 / Usage

```text
鍏?repo_scan 鐪嬩粨搴撴瑙?鈫?鍐?repo_deps 鐪嬩緷璧?鈫?鏈€鍚?repo_refs 鎵炬灦鏋勭儹鐐癸紝
鐒跺悗鍛婅瘔鎴戣繖涓粨搴撶殑妯″潡鍒掑垎鍜屾渶瀹规槗韪╅浄鐨勫湴鏂广€?```

```text
repo_deps 鏌ヤ竴涓?lodash 琚摢浜涙枃浠跺紩鐢紝璇勪及鍒犳帀瀹冪殑褰卞搷闈€?```

## 瀹炵幇璇存槑 / Implementation notes

- **鎶€鏈爤璇嗗埆**锛氭寜 manifest 鏂囦欢瀛樺湪鎬ф帰娴嬶紙`package.json`/`pyproject.toml`/`go.mod`/`Cargo.toml` 绛夛級銆?- **渚濊禆瑙ｆ瀽**锛歚package.json` 鐢?JSON.parse锛沗pyproject.toml` / `go.mod` / `Cargo.toml` 鐢ㄥ惎鍙戝紡瀛愰泦瑙ｆ瀽锛屽紓甯告竻鍗曚細瀹夊叏璺宠繃銆?- **寮曠敤鍥?*锛氬 `.ts/.tsx/.js/.jsx/.mjs/.cjs/.py` 鍋?import/require 姝ｅ垯鎵弿锛岃В鏋愭湰鍦扮浉瀵瑰紩鐢ㄥ苟瑙勮寖鍖栦负鏂囦欢璺緞锛屾寜鐩綍鑱氬悎杈广€?*鍚彂寮忚€岄潪 AST 绮剧‘**鈥斺€旂敤浜庢灦鏋勬瑙堣冻澶燂紝鍒嬁瀹冨綋闈欐€佸垎鏋愬櫒鐨勪緷鎹€?- **瀹夊叏**锛氭墍鏈夌敤鎴疯緭鍏ヨ矾寰勭粡 `resolveWithin` 鏍￠獙锛堝繀椤昏惤鍦?root 鍐咃級锛涚鍙烽摼鎺ユ枃浠朵細 `stat` 鍚庢寜鐪熷疄鏂囦欢澶勭悊銆?
## 寮€鍙?/ Development

```bash
npm install
npm run build   # tsc -> lib/
npm test       # node --test (built-in runner)
```

鏈湴楠岃瘉锛堜娇鐢ㄥ鍒跺嚭鐨?profile锛夛細

```bash
cp -r ~/.dsh/profiles/headless ~/.dsh/profiles/analyze-test
dsh plugin --profile analyze-test add /path/to/dsh-repo-analyzer
dsh --profile analyze-test --dump-config      # 纭琛ヤ竵鐢熸晥
dsh --profile analyze-test "鐢?repo_scan 鍒嗘瀽杩欎釜浠撳簱鐨勬妧鏈爤"
```

## License

MIT