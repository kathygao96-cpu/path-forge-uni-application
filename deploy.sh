#!/bin/bash
set -e

# 配置你的本地路径和服务器信息
LOCAL_DIR="/path/to/your/project"
SERVER="ubuntu@YOUR_SERVER_IP"
KEY="$LOCAL_DIR/YOUR_KEY.pem"
REMOTE_DIR="/root/path-forge"

echo "===== 1. 打包本地代码 ====="
tar czf /tmp/path-forge-deploy.tar.gz \
  --exclude='.git' \
  --exclude='node_modules' \
  --exclude='forgepath1.pem' \
  --exclude='data/secret.json' \
  --exclude='storage/*.db' \
  --exclude='storage/*.json' \
  --exclude='.DS_Store' \
  -C "$LOCAL_DIR" .

echo "===== 2. 上传到服务器 ====="
scp -i "$KEY" /tmp/path-forge-deploy.tar.gz "$SERVER":/home/ubuntu/

echo "===== 3. 解压并部署 ====="
ssh -i "$KEY" "$SERVER" "
  rm -rf /home/ubuntu/path-forge-deploy
  mkdir -p /home/ubuntu/path-forge-deploy
  tar xzf /home/ubuntu/path-forge-deploy.tar.gz -C /home/ubuntu/path-forge-deploy/
  sudo cp -r /home/ubuntu/path-forge-deploy/* $REMOTE_DIR/
  sudo chown -R root:root $REMOTE_DIR
  sudo pm2 restart path-forge
  sudo pm2 save
"

echo "===== 部署完成 ====="
