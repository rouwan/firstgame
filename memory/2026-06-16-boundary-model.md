---
name: boundary-safety-model
description: 边界安全模型 —— 前轮占据点作为后轮安全边界的递归套娃模型
metadata:
  type: project
---

## 核心认知

**"指向前轮线 = 安全"。** 前轮线先飞走，后轮线指向前轮线不会被堵。这打破了"绝不能指向任何线"的死规矩。

## 分层边界

- 第 1 轮：边界 = 物理边界（head 紧挨棋盘边缘，射线一步出界）
- 第 2+ 轮：边界 = 物理边界 + 前轮占据点（`boundarySet = _genAlreadyPlaced`）

## 射线扫描规则

遇到 boundarySet 线不能 break —— 继续扫完整条射线，检查对头箭。

## 相关

[[dag-cycle-issue]] [[arrow-matrix-generation]]
