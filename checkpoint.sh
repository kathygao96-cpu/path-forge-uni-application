#!/bin/bash
set -e

LOCAL_DIR="/Users/mac/Desktop/Lush sides/Entrep/App/WayTo 能力图鉴"
SERVER="ubuntu@43.129.175.11"
KEY="$LOCAL_DIR/forgepath1.pem"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
CHECKPOINT_DIR="$LOCAL_DIR/checkpoints/$TIMESTAMP"

echo "===== 创建 Checkpoint: $TIMESTAMP ====="
mkdir -p "$CHECKPOINT_DIR"

# 1. 备份本地代码当前 commit
git -C "$LOCAL_DIR" rev-parse HEAD > "$CHECKPOINT_DIR/git_commit.txt"
echo "Git commit: $(cat "$CHECKPOINT_DIR/git_commit.txt")"

# 2. 备份服务器上的敏感文件
echo "===== 备份服务器数据 ====="
ssh -i "$KEY" "$SERVER" "sudo cat /root/path-forge/data/secret.json" > "$CHECKPOINT_DIR/secret.json" 2>/dev/null || echo "secret.json 备份失败"
ssh -i "$KEY" "$SERVER" "sudo cat /root/path-forge/storage/data.db" > "$CHECKPOINT_DIR/data.db" 2>/dev/null || echo "data.db 备份失败"
ssh -i "$KEY" "$SERVER" "sudo cat /root/path-forge/storage/leads.json" > "$CHECKPOINT_DIR/leads.json" 2>/dev/null || echo "leads.json 备份失败"
ssh -i "$KEY" "$SERVER" "sudo cat /root/path-forge/storage/events.json" > "$CHECKPOINT_DIR/events.json" 2>/dev/null || echo "events.json 备份失败"

# 3. 记录 PM2 状态
ssh -i "$KEY" "$SERVER" "sudo pm2 describe path-forge" > "$CHECKPOINT_DIR/pm2_status.txt" 2>/dev/null || echo "PM2 状态备份失败"

echo "===== Checkpoint 完成 ====="
echo "位置: $CHECKPOINT_DIR"
echo ""
echo "回滚命令:"
echo "  代码: git checkout $(cat "$CHECKPOINT_DIR/git_commit.txt")"
echo "  数据: scp -i $KEY $CHECKPOINT_DIR/* $SERVER:/root/path-forge/对应目录/"
