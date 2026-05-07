export type Category = 'Technical' | 'Financial' | 'Legal' | 'Other';
export type Status = 'pending' | 'compliant' | 'exception' | 'clarify';

export interface Requirement {
  id: string;
  requirement: string;
  category: Category;
  pageNumber: number;
  keyword: string;
  status: Status;
  notes?: string;
  priority: 'High' | 'Medium' | 'Low';
  reasoning?: string;
}

export interface HistoryItem {
  id: string;
  result: AnalysisResult;
  timestamp: string;
}

export interface AnalysisResult {
  requirements: Requirement[];
  documentName: string;
  totalRequirements: number;
  analysisDate: string;
}
