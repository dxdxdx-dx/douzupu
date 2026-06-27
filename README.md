# 窦氏族谱静态网站

这是一个纯静态家族谱网站，可以在本地编辑数据，然后部署到 GitHub Pages。公开访问者只能查看族谱、搜索成员、缩放视图，不能在网页上新增、编辑或删除数据。

## 工作方式

- 本地编辑：在本机直接打开 `index.html`，或用 `http://localhost:8080` 访问，会自动进入编辑模式。
- 公开只读：部署到 GitHub Pages 后，会自动进入只读模式，隐藏所有编辑入口。
- 数据发布：本地编辑保存到浏览器草稿，点击“导出 data.js”生成公开数据文件；把导出的 `data.js` 替换项目里的 `data.js` 后提交到 GitHub。

## 本地编辑

推荐用本地服务器打开，浏览器存储更稳定：

```bash
python -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

在本地编辑模式中可以：

- 编辑家族简介
- 添加、编辑、删除族谱成员
- 上传成员照片，照片会压缩后写进导出的 `data.js`
- 加载示例数据
- 导出新的 `data.js`
- 放弃本地草稿，恢复到当前 `data.js`

如果想在本地预览公开只读效果，访问：

```text
http://localhost:8080?view=public
```

## 发布更新

1. 在本地编辑并保存族谱内容。
2. 点击页面顶部的“导出 data.js”。
3. 用导出的文件替换项目根目录里的 `data.js`。
4. 提交并推送到 GitHub。
5. GitHub Pages 更新后，其他人看到的就是最新只读版本。

## 部署到 GitHub Pages

如果还没有 Git 仓库，可以在项目目录中执行：

```bash
git init
git add .
git commit -m "Initial family tree site"
```

然后在 GitHub 创建一个仓库，并按 GitHub 给出的命令添加远程地址并推送。推送后，在仓库页面进入：

```text
Settings -> Pages -> Build and deployment
```

选择：

```text
Source: Deploy from a branch
Branch: main
Folder: /root
```

保存后等待 GitHub Pages 生成公开网址。

## 权限说明

GitHub Pages 是静态托管，没有服务器写入接口。访客即使打开网页，也只能在自己的浏览器里查看页面，不能修改你仓库中的 `data.js`，也不能改变别人看到的网站内容。只有拥有仓库写入权限的人，才能通过提交代码更新公开数据。

注意：如果仓库或 Pages 是公开的，`data.js` 里的族谱信息也会公开可见。请不要把不适合公开的隐私信息提交到公开仓库。

## 文件说明

```text
family-tree/
├── index.html      # 页面结构
├── styles.css      # 页面样式
├── app.js          # 查看、编辑、导出逻辑
├── data.js         # 公开展示的数据
├── .nojekyll       # GitHub Pages 静态站辅助文件
└── README.md       # 使用和部署说明
```
