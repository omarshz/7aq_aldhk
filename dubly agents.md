# 🤖 AI Desktop Companion — Project Workspace
> Last Updated: <!-- update this when you make changes -->
> Stack: Godot + Python + LM Studio
> Language: GDScript / Python

---

## 📌 Project Goals

### Vision
> A lightweight floating 3D figure that lives on your desktop, watches your screen, and reacts to what you do — powered by a local LLM (2B or 4B model max). Fast, private, runs fully offline on Mac and Windows.

### Core Features
- [ ] Floating 3D figure rendered on screen (transparent window)
- [ ] Figure moves freely on screen by itself
- [ ] Screen capture — app sees what the user is doing
- [ ] Local LLM integration (2B/4B via llama.cpp)
- [ ] Fast response time (low latency inference)
- [ ] Cross-platform support: Mac & Windows

### Target Platform
- [ ] Windows
- [ ] macOS

---

## 👥 Team

| Role | Person | Responsibilities |
|------|--------|-----------------|
| 🔴 Dev 1 | Name | e.g. 3D figure, Godot window |
| 🔵 Dev 2 | Name | e.g. LLM integration, screen capture |

---

## 📋 Task Board

### 🔴 Dev 1 — In Progress
- [ ] Task name — *description*
- [ ] Task name — *description*

### 🔵 Dev 2 — In Progress
- [ ] Task name — *description*
- [ ] Task name — *description*

---

### 📥 To Do (Unassigned)
- [ ] Set up Godot transparent floating window (Mac + Windows)
- [ ] Create/find lightweight 3D character model
- [ ] Implement free movement logic for figure on screen
- [ ] Install LM Studio + load Qwen3.5 (0.8B on Mac / 4B on Windows)
- [ ] Enable LM Studio local API server (runs on localhost:1234)
- [ ] Build Python script to send prompts to LM Studio API
- [ ] Connect screen capture output → LM Studio prompt → response
- [ ] Optimize response latency pipeline
- [ ] Test on Mac & Windows

---

### ✅ Done
- [x] Project idea defined
- [x] Tech stack chosen (Godot + Python + llama.cpp)

---

## 🌿 Git Workflow

```
main         → stable builds only
dev          → active development branch
feature/xxx  → one branch per feature
```

### Rules
1. **Never push directly to `main`**
2. Always branch off `dev` for new features
3. Open a Pull Request when a feature is done
4. The other person reviews before merging
5. Pull from `dev` before starting work each day

### Daily Routine
```bash
git checkout dev
git pull origin dev
git checkout -b feature/your-feature-name
# ... do your work ...
git push origin feature/your-feature-name
# open a Pull Request on GitHub
```

---

## ⚠️ Conflict Zones
> Files that both devs touch — coordinate before editing these!

| File | Owner | Notes |
|------|-------|-------|
| `main_scene.tscn` | Talk first | Core Godot scene |
| `llm_bridge.py` | Talk first | Calls LM Studio API |
| `screen_capture.py` | Talk first | Screen reading module |
| `config.json` | Talk first | App settings & LM Studio port/model |

---

## 💬 Notes & Messages

### 🔴 Dev 1 → Dev 2
> *(leave messages here)*

---

### 🔵 Dev 2 → Dev 1
> *(leave messages here)*

---

## 🐛 Known Bugs
| # | Description | Priority | Assigned |
|---|-------------|----------|----------|
| 1 | | High/Mid/Low | Dev 1/2 |

---

## 🔗 Resources
- [ ] LM Studio download: https://lmstudio.ai
- [ ] LM Studio API docs: https://lmstudio.ai/docs/api
- [ ] Godot transparent window docs: *link*
- [ ] 3D character model: *link to asset*
- [ ] Models (base, may go bigger):
  - **Mac (MLX):** [Qwen3.5 0.8B MLX 8bit](https://huggingface.co/mlx-community/Qwen3.5-0.8B-MLX-8bit) — optimized for Apple Silicon
  - **Windows (GGUF):** [Qwen3.5 4B GGUF](https://huggingface.co/lmstudio-community/Qwen3.5-4B-GGUF) — runs via LM Studio

## 🔌 LM Studio API Quick Reference
```python
import requests

response = requests.post("http://localhost:1234/v1/chat/completions", json={
    "model": "your-model-name",
    "messages": [
        { "role": "system", "content": "You are a helpful desktop companion." },
        { "role": "user", "content": "The user is currently doing: ..." }
    ]
})

print(response.json()["choices"][0]["message"]["content"])
```
> LM Studio must be running with the local server enabled on port 1234