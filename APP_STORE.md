# NearBite 上架 App Store & 赚钱路线

> **当前阶段**：先用 GitHub Pages + PWA 获客验证。确认有人愿意付费后，再走下面的 App Store 流程。

当前仓库已具备：

- 可运行的产品（定位 + 推荐 + 偏好）
- **Freemium**：免费每天 3 次定位查询；超出弹出 Pro 付费墙
- **订阅商品 ID**（需在 App Store Connect 创建）：
  - `app.protiva.meal.pro.monthly`（€4.99/月建议价）
  - `app.protiva.meal.pro.yearly`（€29.99/年建议价）
- Capacitor 配置（`app.protiva.meal`），可用同一套 Web UI 打 iOS / Android 包
- 隐私政策 / 使用条款页面（审核常查）

> 本云环境是 Linux，**不能在这里直接编译出可提交的 iOS `.ipa`**。需要一台 Mac + Xcode，或使用 Mac 云构建（如 Codemagic / GitHub macOS runner）。

---

## 你要赚钱：建议商业模型

| 层级 | 内容 | 收费 |
|------|------|------|
| Free | 目标设置、演示菜单、每天 3 次定位 Top 3 | €0 |
| Pro | 无限定位刷新、完整偏好、后续真实菜单/营养校准优先权 | €4.99/月 或 €29.99/年 |

后续可加（别第一版就全做）：

- 餐厅联盟 / 团购分成（需商务谈判）
- B2B：健身房、酒店白标
- 家庭共享订阅

苹果抽成约 15%–30%（小微开发者计划可能 15%）。

---

## 上架清单（按顺序做）

### 1. 账号与法务（你来完成）

1. 注册 [Apple Developer Program](https://developer.apple.com/programs/)（约 $99/年）
2. 准备可公开访问的隐私政策 URL（可先用 GitHub Pages 的 `privacy.html`）
3. 决定销售地区、年龄分级（NearBite 建议 4+ / 无限制内容）

### 2. 在 Mac 上生成 iOS 工程

```bash
npm install
npm run build
npx cap add ios          # 只需第一次
npx cap sync ios
npx cap open ios         # 打开 Xcode
```

在 Xcode：

- Team → 你的 Apple Developer 团队
- Bundle ID 保持 `app.protiva.meal`
- Signing & Capabilities → 打开 **In-App Purchase**
- 真机或模拟器跑通定位权限文案（Info.plist 位置说明）

建议在 `ios/App/App/Info.plist` 增加：

```xml
<key>NSLocationWhenInUseUsageDescription</key>
<string>NearBite 需要定位，才能推荐你附近好吃且符合卡路里/蛋白目标的餐食。</string>
```

### 3. App Store Connect

1. 新建 App：名称 NearBite，Bundle ID `app.protiva.meal`
2. **订阅群组** → 创建自动续订：
   - 月付：`app.protiva.meal.pro.monthly`
   - 年付：`app.protiva.meal.pro.yearly`
3. 准备截图（iPhone 6.7" / 6.1"）、描述、关键词、支持 URL
4. 审核备注写明：营养为估算；可使用演示菜单；订阅用 Sandbox 测试账号

### 4. 把「模拟购买」换成真 IAP（上架前必须）

现在 `monetization.js` 里的 `purchase()` / `restore()` 是 **mock**，方便网页验证付费墙。

上架前接入其一：

- [RevenueCat](https://www.revenuecat.com/) + `@revenuecat/purchases-capacitor`（推荐，省事）
- 或原生 StoreKit 2

把 `PRODUCTS` 里的 ID 与 Connect 保持一致即可。

### 5. 提交审核

1. Archive → Upload
2. 选订阅商品一并提交
3. 等审核（常见 24–48 小时；定位 + 订阅类可能被追问）

### 6. Android（可选，多一条赚钱渠道）

```bash
npx cap add android
npx cap sync android
```

Google Play 另需开发者账号与 Play Billing（商品 ID 可平行一套）。

---

## 本仓库命令

```bash
npm install
npm run build       # 输出 www/ 给 Capacitor
npm run serve       # 本地网页调试
npm run cap:sync    # build + sync 原生工程
```

---

## 现实预期

- **能上架**：技术路径已打通（Capacitor + 订阅墙 + 隐私条款）
- **能赚钱**：取决于留存与转化；建议先验证「每天真的打开 App 找饭」再砸营销
- **不能跳过**：Apple 账号、Mac/Xcode 签名、真实 IAP、审核材料必须你或合作开发者在苹果侧完成
