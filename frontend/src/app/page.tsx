"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FolderGit2 } from "lucide-react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function Home() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");

  const { data: projects, isLoading } = useQuery({
    queryKey: ["projects"],
    queryFn: api.projects,
  });

  const create = useMutation({
    mutationFn: () =>
      api.createProject({ name: name.trim() || "新项目", description: desc.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setOpen(false);
      setName("");
      setDesc("");
    },
  });

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-text">
          <FolderGit2 className="h-5 w-5 text-primary" /> 项目
        </h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="primary" size="md">
              <Plus className="h-4 w-4" /> 新建项目
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md p-5">
            <DialogTitle className="mb-3 text-base font-semibold text-text">
              新建项目
            </DialogTitle>
            <div className="space-y-3">
              <label className="block text-sm">
                <span className="mb-1 block text-text-secondary">名称</span>
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="例如：智能客服系统"
                  className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-text-secondary">描述（可选）</span>
                <textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  placeholder="一句话描述项目目标"
                  className="h-20 w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  取消
                </Button>
                <Button
                  variant="primary"
                  onClick={() => create.mutate()}
                  disabled={create.isPending}
                >
                  {create.isPending ? "创建中…" : "创建"}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <p className="text-sm text-text-muted">加载项目…</p>
      ) : (projects ?? []).length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-text-muted">
          还没有项目，点击右上角「新建项目」开始。
        </div>
      ) : (
        <ul className="space-y-2">
          {(projects ?? []).map((p) => (
            <li key={p.id}>
              <Link
                href={`/p/${p.id}/material/main`}
                className="block rounded-lg border border-border bg-bg-elevated p-4 transition-colors hover:border-primary"
              >
                <div className="flex items-center justify-between">
                  <b className="text-text">{p.name}</b>
                  {p.currentStage && (
                    <span className="text-xs text-text-muted">
                      阶段：{p.currentStage}
                    </span>
                  )}
                </div>
                {p.description && (
                  <p className="mt-1 text-sm text-text-secondary">{p.description}</p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
