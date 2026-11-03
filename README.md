# Protiva

到饭点推附近**好吃、不超卡、蛋白够**的菜。有网 + 开定位，哪里都能用。  
**性价比只是可选排序。**

## 产品

- 定位搜附近餐厅（OpenStreetMap / Photon）
- 硬条件：不超卡、蛋白够；偏好：好吃 / 蛋白 / 最近 / 性价比
- **Freemium**：免费每天 3 次定位查询；**Protiva Pro** 订阅解锁无限次
- 目标平台：**App Store**（Capacitor 打包）+ 网页演示

## 本地网页

```bash
npm install
npm run serve
```

打开 `http://localhost:8080`。

## 打 iOS 包（需 Mac）

见 **[APP_STORE.md](./APP_STORE.md)**（账号、IAP、审核、赚钱模型）。

```bash
npm run build
npx cap add ios    # 首次
npm run cap:sync
npx cap open ios
```

## 法律页

- [隐私政策](./privacy.html)
- [使用条款](./terms.html)
