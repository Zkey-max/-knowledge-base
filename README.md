# 企微需求采集与知识库问答测试工具

本工具用于本机测试：

1. 从指定企业微信群读取指定用户消息。
2. 将待处理消息写入 SQLite。
3. 支持规则版自动判断需求或知识库问答，也可由当前 Codex 会话辅助处理。
4. 问答类消息可通过企业微信 CLI 自动回复。

## 初始化

```powershell
npm run db:init
npm run wecom:install
$env:WECOM_BOT_ID="你的Bot ID"
$env:WECOM_BOT_SECRET="你的Bot Secret"
npm run wecom:init
npm run wecom:test
```

## 基本使用

发现最近 7 天会话：

```powershell
node src/cli.js wecom chats --hours 167
```

配置监听群和白名单用户：

```powershell
node src/cli.js config group add --chat-id "群ID" --name "需求测试群"
node src/cli.js config user add --user-id "用户ID" --name "用户名称" --role "平台人员"
```

采集一次消息：

```powershell
npm run poll
```

查看待处理消息：

```powershell
npm run tasks
```

Codex 处理时会读取待处理任务，并通过 `tasks apply --file <json>` 写入结果。

## 自动持续检测和处理

启动自动循环：

```powershell
node src/cli.js auto --watch
```

如果 PowerShell 可以正常运行 npm 脚本，也可以使用：

```powershell
npm run auto
```

自动循环会持续执行：采集新消息、读取待处理队列、规则判断、写入需求或问答记录、发送知识库问答回复。

只运行一轮自动处理：

```powershell
node src/cli.js auto --once
```

可调整每轮最多自动处理条数：

```powershell
node src/cli.js config set --key auto_process_limit --value 20
```

临时停用自动处理：

```powershell
node src/cli.js config set --key auto_process_enabled --value false
```

重新启用：

```powershell
node src/cli.js config set --key auto_process_enabled --value true
```

当前自动规则：

1. 命中知识库标题、关键词或问题文本的消息，按知识库问答回复。
2. 包含“需要、希望、能不能、可不可以、建议、优化、增加、修改、调整”等业务诉求的消息，写入需求收集表。
3. 系统提示、图片 Markdown、简单闲聊会自动忽略。
4. 无法判断的消息进入待人工判断，不自动回复。

企业微信 CLI 当前只支持文本消息。知识库里的 Markdown 图片会在回复时转为“参考图片：图片链接”，不会在企微内直接显示成图片。

## 本机后台

启动后台：

```powershell
npm run admin -- --port 8788
```

打开：

```text
http://127.0.0.1:8788
```

启动窗口需要保持打开；如果关闭窗口，后台页面也会无法访问。

如果端口被占用，后台会自动尝试后续端口，启动输出中的 `url` 为实际访问地址。建议优先打开输出里的 `127.0.0.1` 地址，避免 Windows 上 `localhost` 解析到 IPv6 导致访问失败。

后台能力：

1. 查看消息记录、需求记录、问答日志和基础配置。
2. 新增、编辑、启用或停用知识库内容。
3. 通过 Markdown 维护图文知识内容，例如 `![图片说明](图片链接或本地路径)`。
4. 汇总未回答成功内容，包括知识库无命中、低置信度、待人工判断和回复发送失败。
5. 将未回答成功内容补充为知识库条目，并标记为已完善。
