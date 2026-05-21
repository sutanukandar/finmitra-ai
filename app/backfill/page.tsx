'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';

export default function BackfillWizard() {
  const [restaurantId] = useState('b77ed758-9a72-4de2-9138-b353589c656d');
  const [date, setDate] = useState('');
  
  // Revenue
  const [salesQR, setSalesQR] = useState('');
  const [salesCash, setSalesCash] = useState('');
  const [swiggy, setSwiggy] = useState('');
  const [zomato, setZomato] = useState('');

  // Expenses
  const [hyperpure, setHyperpure] = useState('');
  const [bigbasket, setBigbasket] = useState('');
  const [milk, setMilk] = useState('');
  const [bread, setBread] = useState('');
  const [rent, setRent] = useState('');
  const [electricity, setElectricity] = useState('');
  const [gas, setGas] = useState('');
  const [salary, setSalary] = useState('');
  const [other, setOther] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  // Download Excel Template
  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    // Sheet 1: Daily Totals
    const totalsData = [
      ['date', 'sales_qr', 'sales_cash', 'swiggy', 'zomato', 'hyperpure', 'bigbasket', 'milk', 'bread', 'rent', 'electricity', 'gas', 'salary', 'other'],
      ['2026-05-20', '3500', '1200', '800', '600', '2400', '1650', '360', '180', '0', '450', '0', '1200', '300']
    ];
    const totalsSheet = XLSX.utils.aoa_to_sheet(totalsData);
    XLSX.utils.book_append_sheet(wb, totalsSheet, "Daily Totals");

    // Sheet 2: Item Level
    const itemsData = [
      ['date', 'vendor', 'item_name', 'quantity', 'unit', 'amount'],
      ['2026-05-20', 'Hyperpure', 'VIVI - Honey, 1 Kg', '2', 'Kg', '420'],
      ['2026-05-20', 'BigBasket', 'Bru Coffee Powder 500gm', '1', 'Pc', '595']
    ];
    const itemsSheet = XLSX.utils.aoa_to_sheet(itemsData);
    XLSX.utils.book_append_sheet(wb, itemsSheet, "Item Level");

    XLSX.writeFile(wb, 'finmitra-backfill-template.xlsx');
  };

  const handleManualSubmit = async (e: React.FormEvent) => { ... }; // (same as before)

  const handleFileUpload = async (e: React.FormEvent) => { ... }; // (same as before)

  const clearForm = () => { ... }; // (same as before)

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-4xl font-bold">Backfill Wizard</h1>
          <p className="text-gray-600">Add historical data quickly — manual or Excel upload</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 bg-white border border-gray-300 hover:bg-gray-50 px-6 py-3 rounded-2xl font-medium"
        >
          📥 Download Template
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
        {/* Manual Entry Form - same as previous version */}
        <div>
          <h2 className="text-2xl font-semibold mb-6">Manual Entry</h2>
          {/* ... rest of the manual form remains the same ... */}
          {/* (I kept the full form code from previous version for brevity) */}
        </div>

        {/* Excel Upload Section */}
        <div>
          <h2 className="text-2xl font-semibold mb-6">Bulk Upload (Excel/CSV)</h2>
          <form onSubmit={handleFileUpload} className="border-2 border-dashed border-gray-300 rounded-3xl p-8 text-center">
            <input type="file" accept=".xlsx,.csv" onChange={(e) => setFile(e.target.files?.[0] || null)} className="hidden" id="file-upload" />
            <label htmlFor="file-upload" className="cursor-pointer block">
              <div className="text-6xl mb-4">📤</div>
              <p className="font-medium">Drop your Excel or CSV file here</p>
              <p className="text-sm text-gray-500 mt-2">or click to browse</p>
            </label>
            {file && <p className="mt-4 text-sm text-green-600">Selected: {file.name}</p>}
            <button type="submit" disabled={!file || loading} className="mt-8 w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-5 rounded-2xl text-lg disabled:opacity-50">
              {loading ? 'Uploading...' : 'Upload & Backfill'}
            </button>
          </form>
        </div>
      </div>

      {message && (
        <div className="mt-10 p-6 bg-gray-100 rounded-3xl text-center text-lg font-medium">
          {message}
        </div>
      )}
    </div>
  );
}
