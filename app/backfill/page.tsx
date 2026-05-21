'use client';

import { useState } from 'react';
import * as XLSX from 'xlsx';

export default function BackfillWizard() {
  const [restaurantId] = useState('b77ed758-9a72-4de2-9138-b353589c656d');
  const [date, setDate] = useState('');

  // Manual form fields (same as before)
  const [salesQR, setSalesQR] = useState('');
  const [salesCash, setSalesCash] = useState('');
  const [swiggy, setSwiggy] = useState('');
  const [zomato, setZomato] = useState('');
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

  // Download PnL Level Template (Daily Totals only)
  const downloadPnlTemplate = () => {
    const wb = XLSX.utils.book_new();
    const totalsData = [
      ['date', 'sales_qr', 'sales_cash', 'swiggy', 'zomato', 'hyperpure', 'bigbasket', 'milk', 'bread', 'rent', 'electricity', 'gas', 'salary', 'other'],
      ['2026-05-20', '3500', '1200', '800', '600', '2400', '1650', '360', '180', '0', '450', '0', '1200', '300']
    ];
    const sheet = XLSX.utils.aoa_to_sheet(totalsData);
    XLSX.utils.book_append_sheet(wb, sheet, "Daily Totals");
    XLSX.writeFile(wb, 'finmitra-pnl-template.xlsx');
  };

  // Download Invoice Level Template (Item Level only)
  const downloadInvoiceTemplate = () => {
    const wb = XLSX.utils.book_new();
    const itemsData = [
      ['date', 'vendor', 'item_name', 'quantity', 'unit', 'amount'],
      ['2026-05-20', 'Hyperpure', 'VIVI - Honey, 1 Kg', '2', 'Kg', '420'],
      ['2026-05-20', 'BigBasket', 'Bru Coffee Powder 500gm', '1', 'Pc', '595']
    ];
    const sheet = XLSX.utils.aoa_to_sheet(itemsData);
    XLSX.utils.book_append_sheet(wb, sheet, "Item Level");
    XLSX.writeFile(wb, 'finmitra-invoice-template.xlsx');
  };

  // ... (rest of your form logic - handleManualSubmit, handleFileUpload, etc. remain the same)

  return (
    <div className="max-w-5xl mx-auto p-8">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-4xl font-bold">Backfill Wizard</h1>
          <p className="text-gray-600">Add historical data quickly</p>
        </div>
      </div>

      <div className="flex gap-4 mb-8">
        <button
          onClick={downloadPnlTemplate}
          className="flex-1 bg-white border border-gray-300 hover:bg-gray-50 px-6 py-4 rounded-2xl font-medium flex items-center justify-center gap-2"
        >
          📊 Download PnL Template<br/>(Daily Totals)
        </button>
        <button
          onClick={downloadInvoiceTemplate}
          className="flex-1 bg-white border border-gray-300 hover:bg-gray-50 px-6 py-4 rounded-2xl font-medium flex items-center justify-center gap-2"
        >
          📋 Download Invoice Template<br/>(Item Level Bills)
        </button>
      </div>

      {/* Rest of your form (manual entry + bulk upload) remains the same */}
      {/* You can keep the rest of the code from previous version */}

      {message && <div className="mt-10 p-6 bg-gray-100 rounded-3xl text-center text-lg font-medium">{message}</div>}
    </div>
  );
}
