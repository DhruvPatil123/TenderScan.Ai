-- SQL to create the necessary tables in Supabase

-- Create a table for documents
CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
  name TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id),
  total_requirements INTEGER DEFAULT 0
);

-- Create a table for extracted requirements
CREATE TABLE IF NOT EXISTS requirements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  requirement TEXT NOT NULL,
  category TEXT CHECK (category IN ('Technical', 'Financial', 'Legal', 'Other')),
  page_number INTEGER,
  keyword TEXT,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'compliant', 'exception', 'clarify'))
);

-- Enable RLS (Row Level Security)
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE requirements ENABLE ROW LEVEL SECURITY;

-- Create policies (Allow users to see only their own docs)
CREATE POLICY "Users can view their own documents" ON documents
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own documents" ON documents
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view requirements of their own documents" ON requirements
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM documents 
      WHERE documents.id = requirements.document_id 
      AND documents.user_id = auth.uid()
    )
  );
