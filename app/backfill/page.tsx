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

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const totals: any = {};

    if (salesQR || salesCash) totals.sales = (parseFloat(salesQR) || 0) + (parseFloat(salesCash) || 0);
    if (swiggy) totals.swiggy = parseFloat(swiggy);
    if (zomato) totals.zomato = parseFloat(zomato);
    if (hyperpure) totals.hyperpure = parseFloat(hyperpure);
    if (bigbasket) totals.bigbasket = parseFloat(bigbasket);
    if (milk) totals.milk = parseFloat(milk);
    if (bread) totals.bread = parseFloat(bread);
    if (rent) totals.rent = parseFloat(rent);
    if (electricity) totals.electricity = parseFloat(electricity);
    if (gas) totals.gas = parseFloat(gas);
    if (salary) totals.salary = parseFloat(salary);
    if (other) totals.other = parseFloat(other);

    const payload = {
      restaurant_id: restaurantId,
      entries: [{ date, totals }]
    };

    try {
      const res = await fetch('/api/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const data = await res.json();
      if (data.success) {
        setMessage('✅ Backfill saved successfully!');
        clearForm();
      } else {
        setMessage('❌ ' + (data.error || 'Failed to save'));
      }
    } catch (err) {
      setMessage('❌ Server error');
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    setLoading(true);
    setMessage('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('restaurant_id', restaurantId);

    try {
      const res = await fetch('/api/backfill', {
        method: 'POST',
        body: formData
      });

      const data = await res.json();
      if (data.success) {
        setMessage(`✅ ${data.results.length} entries saved successfully!`);
        setFile(null);
      } else {
        setMessage('❌ ' + (data.error || 'Upload failed'));
      }
    } catch (err) {
      setMessage('❌ Failed to upload file');
    } finally {
      setLoading(false);
    }
  };

  const clearForm = () => {
    setDate('');
    setSalesQR(''); setSalesCash(''); setSwiggy(''); setZomato('');
    setHyperpure(''); setBigbasket(''); setMilk(''); setBread('');
    setRent(''); setElectricity(''); setGas(''); setSalary(''); setOther('');
  };

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
        {/* Manual Entry */}
        <div>
          <h2 className="text-2xl font-semibold mb-6">Manual Entry</h2>
          <form onSubmit={handleManualSubmit} className="space-y-8">
            <div>
              <label className="block text-sm font-medium mb-2">Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" required />
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4 text-green-700">Revenue / Sales</h3>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium mb-2">Sales (QR)</label>
                  <input type="number" value={salesQR} onChange={(e) => setSalesQR(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" placeholder="2500" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Sales (Cash)</label>
                  <input type="number" value={salesCash} onChange={(e) => setSalesCash(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" placeholder="1000" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Swiggy</label>
                  <input type="number" value={swiggy} onChange={(e) => setSwiggy(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Zomato</label>
                  <input type="number" value={zomato} onChange={(e) => setZomato(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" />
                </div>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4 text-red-700">Expenses</h3>
              <div className="grid grid-cols-2 gap-6">
                <div><label className="block text-sm font-medium mb-2">Hyperpure</label><input type="number" value={hyperpure} onChange={(e) => setHyperpure(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" /></div>
                <div><label className="block text-sm font-medium mb-2">BigBasket</label><input type="number" value={bigbasket} onChange={(e) => setBigbasket(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" /></div>
                <div><label className="block text-sm font-medium mb-2">Milk</label><input type="number" value={milk} onChange={(e) => setMilk(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" /></div>
                <div><label className="block text-sm font-medium mb-2">Bread</label><input type="number" value={bread} onChange={(e) => setBread(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" /></div>
                <div><label className="block text-sm font-medium mb-2">Rent</label><input type="number" value={rent} onChange={(e) => setRent(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" /></div>
                <div><label className="block text-sm font-medium mb-2">Electricity</label><input type="number" value={electricity} onChange={(e) => setElectricity(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" /></div>
                <div><label className="block text-sm font-medium mb-2">Gas</label><input type="number" value={gas} onChange={(e) => setGas(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" /></div>
                <div><label className="block text-sm font-medium mb-2">Salary</label><input type="number" value={salary} onChange={(e) => setSalary(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" /></div>
                <div><label className="block text-sm font-medium mb-2">Metro / Instamart / Local</label><input type="number" value={other} onChange={(e) => setOther(e.target.value)} className="w-full border border-gray-300 rounded-xl px-5 py-4" /></div>
              </div>
            </div>

            <button type="submit" disabled={loading} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-5 rounded-2xl text-lg disabled:opacity-50">
              {loading ? 'Saving...' : 'Save Manual Entry'}
            </button>
          </form>
        </div>

        {/* Excel Upload */}
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
