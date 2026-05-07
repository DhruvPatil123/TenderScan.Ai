import { AnalysisResult } from "../types";

export function exportToCSV(result: AnalysisResult) {
  const headers = ["Requirement", "Category", "Page", "Keyword", "Status", "Notes"];
  const rows = result.requirements.map(req => [
    `"${req.requirement.replace(/"/g, '""')}"`,
    req.category,
    req.pageNumber,
    req.keyword,
    req.status,
    `"${(req.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map(r => r.join(","))
  ].join("\n");

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", `Compliance_Matrix_${result.documentName.split('.')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
