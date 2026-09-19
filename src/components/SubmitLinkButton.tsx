"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import SubmitLinkModal from "./SubmitLinkModal";
import { canSubmit, type UserRole } from "./types";

type SubmitLinkButtonProps = {
  role: UserRole;
};

export default function SubmitLinkButton({ role }: SubmitLinkButtonProps) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  if (!canSubmit(role)) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        aria-haspopup="dialog"
        className="flex items-center justify-center gap-2 rounded-full bg-gradient-to-r from-primary to-[#1846b0] px-6 py-3 text-sm font-bold text-white shadow-[0_10px_20px_-10px_rgba(36,98,250,0.5)] transition-[transform,box-shadow] hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-8px_rgba(36,98,250,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 active:scale-95"
      >
        <Plus aria-hidden="true" size={18} strokeWidth={3} />
        Submit link
      </button>

      <SubmitLinkModal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} />
    </>
  );
}
