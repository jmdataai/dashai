import React, { useCallback, useRef, useState } from "react";
import axios from "axios";
import { toast, Toaster } from "sonner";
import Sidebar from "@/components/Sidebar";
import EmptyState from "@/components/EmptyState";
import Dashboard from "@/components/Dashboard";
import LoadingState from "@/components/LoadingState";
import "@/App.css";

const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export default function App() {
  const [dataset, setDataset] = useState(null);
  const [dashboard, setDashboard] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dashboardRef = useRef(null);

  const handleUpload = useCallback(async (file) => {
    if (!file) return;
    setUploading(true);
    setDashboard(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await axios.post(`${API}/datasets/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setDataset(data);
      toast.success(`${data.filename} loaded · ${data.rows.toLocaleString()} rows`);
      // Auto-generate first dashboard for instant wow
      generate(data.id);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const loadSample = useCallback(async (name) => {
    setUploading(true);
    setDashboard(null);
    try {
      const { data } = await axios.post(`${API}/sample/${name}`);
      setDataset(data);
      toast.success(`Sample loaded: ${name}`);
      generate(data.id);
    } catch (e) {
      toast.error("Could not load sample");
    } finally {
      setUploading(false);
    }
  }, []);

  const generate = useCallback(async (id, seed) => {
    const datasetId = id || dataset?.id;
    if (!datasetId) return;
    setGenerating(true);
    try {
      const { data } = await axios.post(
        `${API}/datasets/${datasetId}/generate`,
        seed != null ? { seed } : {}
      );
      setDashboard(data);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Generation failed");
    } finally {
      setGenerating(false);
    }
  }, [dataset]);

  const exportHtml = useCallback(async () => {
    if (!dashboard) return;
    setExporting(true);
    try {
      const res = await axios.post(
        `${API}/export/html`,
        { dashboard },
        { responseType: "blob" }
      );
      const blob = new Blob([res.data], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${dashboard.title.replace(/\s+/g, "_")}.html`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("HTML exported");
    } catch (e) {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  }, [dashboard]);

  const exportPng = useCallback(async () => {
    if (!dashboard || !dashboardRef.current) return;
    setExporting(true);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const canvas = await html2canvas(dashboardRef.current, {
        backgroundColor: "#04070D",
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      link.download = `${dashboard.title.replace(/\s+/g, "_")}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      toast.success("PNG exported");
    } catch (e) {
      toast.error("PNG export failed");
    } finally {
      setExporting(false);
    }
  }, [dashboard]);

  const reset = () => {
    setDataset(null);
    setDashboard(null);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[var(--bg-void)]" data-testid="app-shell">
      <Sidebar
        dataset={dataset}
        dashboard={dashboard}
        uploading={uploading}
        generating={generating}
        exporting={exporting}
        onUpload={handleUpload}
        onSample={loadSample}
        onGenerate={() => generate()}
        onRegenerate={() => generate()}
        onExportHtml={exportHtml}
        onExportPng={exportPng}
        onReset={reset}
      />

      <main
        className="flex-1 overflow-y-auto dash-scroll"
        data-testid="main-pane"
      >
        {!dataset && !uploading && (
          <EmptyState onSample={loadSample} onUpload={handleUpload} />
        )}
        {(uploading || generating) && !dashboard && (
          <LoadingState
            stage={uploading ? "Profiling dataset…" : "AI architecting your dashboard…"}
          />
        )}
        {dashboard && (
          <Dashboard
            ref={dashboardRef}
            dashboard={dashboard}
            generating={generating}
            dataset={dataset}
          />
        )}
      </main>

      <Toaster
        theme="dark"
        position="bottom-right"
        toastOptions={{
          style: {
            background: "#0E1420",
            border: "1px solid #1A2333",
            color: "#F8FAFC",
            fontFamily: "IBM Plex Sans",
          },
        }}
      />
    </div>
  );
}
