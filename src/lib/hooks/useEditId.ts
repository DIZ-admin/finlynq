"use client";

import { useSearchParams } from "next/navigation";

export function useEditId() {
  const searchParams = useSearchParams();
  const editIdParam = searchParams.get("editId");
  const editId = editIdParam ? Number(editIdParam) : null;
  const isEdit = editId != null && Number.isFinite(editId) && editId > 0;
  return { editId, isEdit };
}
