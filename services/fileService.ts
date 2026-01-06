
import * as XLSX from 'xlsx';
import Papa from 'papaparse';

export class FileService {
  async parseFile(file: File): Promise<{ headers: string[]; rows: any[] }> {
    const extension = file.name.split('.').pop()?.toLowerCase();

    if (extension === 'csv') {
      return new Promise((resolve, reject) => {
        Papa.parse(file, {
          header: false, // Parse as arrays first to handle duplicates manually
          skipEmptyLines: true,
          complete: (results) => {
            if (results.data.length === 0) return resolve({ headers: [], rows: [] });
            
            const rawHeaders = (results.data[0] as string[]).map(h => h.trim());
            const headers = this.uniqueHeaders(rawHeaders);
            
            const rows = (results.data.slice(1) as any[][]).map(row => {
              const obj: any = {};
              headers.forEach((h, i) => {
                obj[h] = row[i];
              });
              return obj;
            }).filter(row => Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== ''));

            resolve({ headers, rows });
          },
          error: (err) => reject(err)
        });
      });
    } else if (extension === 'xlsx' || extension === 'xls') {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const data = new Uint8Array(e.target?.result as ArrayBuffer);
            const workbook = XLSX.read(data, { type: 'array' });
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, blankrows: false });
            
            if (json.length === 0) return resolve({ headers: [], rows: [] });
            
            let headerIndex = 0;
            for (let i = 0; i < Math.min(json.length, 10); i++) {
              const row = json[i] as any[];
              if (row.filter(cell => cell !== null && cell !== undefined && String(cell).trim() !== '').length >= 2) {
                headerIndex = i;
                break;
              }
            }

            const rawHeaders = (json[headerIndex] as any[]).map(h => String(h || '').trim());
            const headers = this.uniqueHeaders(rawHeaders);

            const rows = json.slice(headerIndex + 1).map((row: any) => {
              const obj: any = {};
              headers.forEach((h, i) => {
                obj[h] = row[i];
              });
              return obj;
            }).filter(row => Object.values(row).some(v => v !== null && v !== undefined && String(v).trim() !== ''));
            
            resolve({ headers, rows });
          } catch (err) {
            reject(err);
          }
        };
        reader.readAsArrayBuffer(file);
      });
    } else {
      throw new Error('Unsupported file format');
    }
  }

  private uniqueHeaders(rawHeaders: string[]): string[] {
    const seen = new Map<string, number>();
    return rawHeaders.map((h, i) => {
      const baseName = h || `Column ${i + 1}`;
      const count = seen.get(baseName.toLowerCase()) || 0;
      seen.set(baseName.toLowerCase(), count + 1);
      
      // If we've seen this name before, or if we look ahead and see it again, disambiguate
      const isDuplicate = rawHeaders.filter(header => (header || "").toLowerCase() === baseName.toLowerCase()).length > 1;
      
      if (isDuplicate) {
        return `${baseName} (col ${i + 1})`;
      }
      return baseName;
    });
  }

  downloadCSV(filename: string, data: any[]) {
    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

export const fileService = new FileService();
