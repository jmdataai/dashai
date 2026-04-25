# DashAI — AI Dashboard Builder

Upload any CSV or Excel file → AI generates a professional, interactive dashboard in seconds.

---

## Project Structure

```
dashai/
├── backend/
│   ├── main.py           ← FastAPI app (deploy to HuggingFace Spaces)
│   └── requirements.txt
└── frontend/
    ├── index.html        ← Main app (deploy to Netlify / Vercel)
    ├── style.css
    └── main.js
```

---

## Step 1 — Deploy Backend on HuggingFace Spaces

### Create the Space

1. Go to [huggingface.co/new-space](https://huggingface.co/new-space)
2. Settings:
   - **Space name**: `dashai` (or anything you like)
   - **SDK**: `Docker`  ← important, not Gradio
   - **Visibility**: Public (or Private if you prefer)

### Add a Dockerfile

Create `Dockerfile` in the Space root:

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py .
EXPOSE 7860
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "7860"]
```

### Upload Files

Upload these two files to the Space:
- `backend/main.py`  → `main.py`
- `backend/requirements.txt` → `requirements.txt`
- The `Dockerfile` above → `Dockerfile`

### Add API Key Secrets

Space → Settings → **Repository secrets** → Add:

| Secret name      | Value                     | Required? |
|------------------|---------------------------|-----------|
| `GROQ_API_KEY`   | `gsk_...`                 | ✅ Free at console.groq.com |
| `GOOGLE_API_KEY` | `AIza...`                 | ✅ Free at aistudio.google.com |
| `OPENAI_API_KEY` | `sk-...`                  | Optional (paid) |
| `ANTHROPIC_API_KEY` | `sk-ant-...`           | Optional (paid) |
| `LLM_PROVIDER`   | `groq`                    | Optional (default: groq) |
| `ALLOWED_ORIGINS`| `https://your-site.netlify.app` | Recommended for security |

### Your Backend URL

After deployment your backend will be at:
```
https://YOUR-USERNAME-dashai.hf.space
```

Check it works: `https://YOUR-USERNAME-dashai.hf.space/health`

---

## Step 2 — Deploy Frontend on Netlify

### Option A — Netlify Drop (fastest, 60 seconds)

1. Go to [app.netlify.com/drop](https://app.netlify.com/drop)
2. Drag the entire `frontend/` folder onto the page
3. You get a live URL instantly (e.g. `https://silly-name-123.netlify.app`)

### Option B — Netlify from GitHub

1. Push `frontend/` to a GitHub repo
2. Connect repo at [app.netlify.com](https://app.netlify.com)
3. Build settings: leave blank (static site)
4. Publish directory: `frontend`

### Set the Backend URL

Open `frontend/index.html` and update this line **before deploying**:

```html
<script>window.DASHAI_API = "https://YOUR-USERNAME-dashai.hf.space";</script>
```

---

## Local Development

### Backend

```bash
cd backend
pip install -r requirements.txt

# Set keys
export GROQ_API_KEY=gsk_...
export GOOGLE_API_KEY=AIza...

uvicorn main:app --reload --port 8000
# → http://localhost:8000/health
```

### Frontend

Just open `frontend/index.html` in your browser — no build step needed.
The default `window.DASHAI_API` points to `http://localhost:8000`.

---

## AI Provider Priority

The backend automatically cascades through providers in this order:

| Priority | Provider  | Model                     | Limit (free) |
|----------|-----------|---------------------------|--------------|
| 1st      | Groq      | llama-3.3-70b-versatile   | 14,400 req/day |
| 2nd      | Gemini    | gemini-2.5-flash-lite     | 1,000 req/day |
| 3rd      | OpenAI    | gpt-4o-mini               | Paid |
| 4th      | Anthropic | claude-haiku              | Paid |

Only providers with a key set are attempted. If all fail, the frontend uses a
built-in rule-based fallback so users always see a dashboard.

---

## Supported Chart Types

| Type       | When used |
|------------|-----------|
| Line       | Datetime + numeric (animated if time series) |
| Bar        | Categorical + numeric |
| Scatter    | Numeric vs numeric |
| Pie/Donut  | Category proportions |
| Histogram  | Single numeric distribution |
| Box plot   | Multi-column statistical comparison |
| Heatmap    | Correlation matrix (3+ numeric cols) |
| 3D Scatter | 3+ numeric dimensions |

---

## Data Privacy

All file parsing and profiling happens **in the browser** — raw data never leaves
the user's machine. Only the column profile (column names, types, stats, 5 sample
values) is sent to the backend to generate the dashboard spec.
