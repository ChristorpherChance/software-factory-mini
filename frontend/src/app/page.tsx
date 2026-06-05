"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, FolderGit2, Pencil, Trash2 } from "lucide-react";
import { api, type Project } from "@/lib/api";
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

  // 编辑态：选中要编辑的项目 + 草稿
  const [editTarget, setEditTarget] = useState<Project | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

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

  const update = useMutation({
    mutationFn: () =>
      api.updateProject(
        editTarget!.id,
        { name: editName.trim() || editTarget!.name, description: editDesc.trim() || undefined },
        editTarget!.version ?? 1
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      setEditTarget(null);
    },
  });

  const remove = useMutation({
    mutationFn: (pid: string) => api.deleteProject(pid),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });

  const openEdit = (p: Project) => {
    setEditTarget(p);
    setEditName(p.name);
    setEditDesc(p.description ?? "");
  };

  const onDelete = (p: Project) => {
    if (confirm(`确认删除项目「${p.name}」？该项目将从列表移除。`)) {
      remove.mutate(p.id);
    }
  };

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
            <li key={p.id} className="group relative">
              <Link
                href={`/p/${p.id}/material/main`}
                className="block rounded-lg border border-border bg-bg-elevated p-4 pr-20 transition-colors hover:border-primary"
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

              {/* 卡片右上角操作：编辑 / 删除（stopPropagation 防触发 Link 跳转） */}
              <div className="absolute right-3 top-3 flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openEdit(p);
                  }}
                  title="编辑基础信息"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg text-text-secondary hover:border-primary hover:text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete(p);
                  }}
                  title="删除项目"
                  className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-bg text-text-secondary hover:border-error hover:text-error"
                  disabled={remove.isPending}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* 编辑项目基础信息 Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-w-md p-5">
          <DialogTitle className="mb-3 text-base font-semibold text-text">
            编辑项目
          </DialogTitle>
          <div className="space-y-3">
            <label className="block text-sm">
              <span className="mb-1 block text-text-secondary">名称</span>
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-text-secondary">描述</span>
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                placeholder="一句话描述项目目标"
                className="h-20 w-full resize-none rounded-md border border-border bg-bg px-3 py-2 text-sm outline-none focus:border-primary"
              />
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setEditTarget(null)}>
                取消
              </Button>
              <Button
                variant="primary"
                onClick={() => update.mutate()}
                disabled={update.isPending}
              >
                {update.isPending ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
