"""软件工厂缩小版 · 后端应用包（方案甲 · 本地可运行版）。

技术基线对齐 S3 技术选型方案（方案甲），本地运行做了以下可移植适配：
- 数据库：默认 SQLite(aiosqlite)，云端可切 Postgres（DATABASE_URL）。
- 事件总线：默认进程内异步 pub/sub（保留 publish/subscribe 同签名），可切 Redis。
- LLM：默认 stub（确定性、离线、可测），可切 anthropic（LLM_PROVIDER=anthropic）。
"""

__version__ = "0.1.0"
