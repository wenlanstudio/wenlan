# 示视图代码运行 · UI 回归

第一页的代码块：点 ▶ 应弹出半透明结果浮层，代码仍能透出来。

```python
print("hello from exec-present")
for i in range(3):
    print("row", i)
```

## 第二页 · 分页续片

下面这段故意写长，让物理分页切成续片，验证每个切片都能挂上 ▶。

```python
for i in range(1, 41):
    print(f"line {i:02d}: 示视图代码块运行回归")
```

同一章里第二个可跑块，应有 ⏩ 重放按钮。

```python
print("second block in the same chapter")
```
