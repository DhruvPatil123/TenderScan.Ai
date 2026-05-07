import { GoogleGenAI, Type } from "@google/genai";
import { AnalysisResult } from "../types";

// In AI Studio, process.env.GEMINI_API_KEY is available to the client securely
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export async function analyzeRequirements(pages: string[], fileName: string): Promise<AnalysisResult> {
  const fullTextWithPages = pages
    .map((text, index) => `[PAGE ${index + 1}]\n${text}`)
    .join('\n\n');

  // Truncate to stay within safe token limits for Flash models
  const MAX_CHAR_LENGTH = 45000;
  const processedText = fullTextWithPages.substring(0, MAX_CHAR_LENGTH);

  const prompt = `
    You are an expert procurement and compliance analyst. Analyze the provided tender document text and extract all specific mandatory requirements.
    Requirements are often indicated by words like "shall", "must", "required", "will", "mandatory".
    
    Categorize each requirement as:
    - Technical: Specifications, engineering, methodology, performance, SLAs.
    - Financial: Pricing, insurance, bonds, audit, payment terms.
    - Legal: Compliance, liability, termination, governance, IP, GDPR.
    - Other: Administrative items, submission formats, etc.

    Document: ${fileName}
    Text content:
    ${processedText}
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            requirements: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  requirement: { type: Type.STRING, description: "The full text of the requirement" },
                  category: { type: Type.STRING, enum: ["Technical", "Financial", "Legal", "Other"] },
                  pageNumber: { type: Type.NUMBER, description: "Estimated page number" },
                  keyword: { type: Type.STRING, description: "The mandatory word found (e.g. 'shall')" },
                  status: { type: Type.STRING, enum: ["pending", "compliant", "exception", "clarify"] },
                  priority: { type: Type.STRING, enum: ["High", "Medium", "Low"], description: "Severity or importance of the requirement" },
                  reasoning: { type: Type.STRING, description: "A brief professional explanation of why this was flagged and its potential impact." }
                },
                required: ["requirement", "category", "pageNumber", "keyword", "status", "priority", "reasoning"]
              }
            }
          },
          required: ["requirements"]
        }
      }
    });

    const jsonStr = response.text || '{"requirements": []}';
    const rawResult = JSON.parse(jsonStr);
    
    return {
      requirements: rawResult.requirements.map((req: any, index: number) => ({
        ...req,
        id: `req-${Date.now()}-${index}`
      })),
      documentName: fileName,
      totalRequirements: rawResult.requirements.length,
      analysisDate: new Date().toISOString()
    };
  } catch (error) {
    console.error('Gemini Analysis Failed:', error);
    throw new Error('Failed to analyze document. Please check your connection and try again.');
  }
}
