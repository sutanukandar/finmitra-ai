'use client';

import { useState } from 'react';

export default function BackfillPage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');
  const [restaurantId] = useState('b77ed758-9a72-4de2-9138-b353589c656d'); // Your test restaurant ID

  // Manual entry states
  const [date, setDate] = useState('');
  const [salesQr, setSalesQr] = useState('');
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setSelectedFile(file);
    if (file) {
      console.log('✅ File selected:', file.name);
    }
  };

  const handleFileUpload = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setMessage('');

    const formData = new FormData();
    formData.append('file', selectedFile);
    formData.append('restaurant_id', restaurantId);

    try {
      const res = await fetch('/api/backfill', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (data.success) {
        setMessage(`✅ Success! ${data.results?.length || 0} entries processed.`);
        setSelectedFile(null);
      } else {
        setMessage(`❌ Error: ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`❌ Upload failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const downloadTemplate = (type: 'pnl' | 'invoice') => {
    const link = document.createElement('a');
    link.href = type === 'pnl' 
      ? '/templates/finmitra-pnl-template.xlsx' 
      : '/templates/finmitra-invoice-template.xlsx';
    link.download = type === 'pnl' ? 'finmitra-pnl-template.xlsx' : 'finmitra-invoice-template.xlsx';
    link.click();
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const payload = {
      restaurant_id: restaurantId,
      entries: [{
        date,
        totals: {
          sales: Number(salesQr || 0) + Number(salesCash || 0),
          swiggy: Number(swiggy || 0),
          zomato: Number(zomato || 0),
          hyperpure: Number(hyperpure || 0),
          bigbasket: Number(bigbasket || 0),
          milk: Number(milk || 0),
          bread: Number(bread || 0),
          rent: Number(rent || 0),
          electricity: Number(electricity || 0),
          gas: Number(gas || 0),
          salary: Number(salary || 0),
          other: Number(other || 0),
        }
      }]
    };

    try {
      const res = await fetch('/api/backfill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setMessage('✅ Manual entry saved successfully!');
        // Clear form
        setDate(''); setSalesQr(''); setSalesCash(''); setSwiggy(''); setZomato('');
        setHyperpure(''); setBigbasket(''); setMilk(''); setBread(''); setRent('');
        setElectricity(''); setGas(''); setSalary(''); setOther('');
      } else {
        setMessage(`❌ ${data.error}`);
      }
    } catch (err: any) {
      setMessage(`❌ ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">FinMitra Backfill Wizard</h1>

      {/* Manual Entry */}
      <form onSubmit={handleManualSubmit} className="bg-white p-6 rounded-xl shadow mb-10">
        <h2 className="text-xl font-semibold mb-4">Manual Daily Entry</h2>
        <div className="grid grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-full p-3 border rounded-lg" required />
          </div>
          {/* Revenue Section */}
          <div className="col-span-2">
            <h3 className="font-medium mb-3 text-green-700">Revenue / Sales</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm">Sales (QR)</label>
                <input type="number" value={salesQr} onChange={(e) => setSalesQr(e.target.value)} className="w-full p-3 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm">Sales (Cash)</label>
                <input type="number" value={salesCash} onChange={(e) => setSalesCash(e.target.value)} className="w-full p-3 border rounded-lg" />
              </div>
            </div>
          </div>
          {/* Expenses */}
          <div className="col-span-2">
            <h3 className="font-medium mb-3 text-red-700">Expenses</h3>
            <div className="grid grid-cols-3 gap-4">
              <input placeholder="Swiggy" value={swiggy} onChange={(e) => setSwiggy(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="Zomato" value={zomato} onChange={(e) => setZomato(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="Hyperpure" value={hyperpure} onChange={(e) => setHyperpure(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="BigBasket" value={bigbasket} onChange={(e) => setBigbasket(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="Milk" value={milk} onChange={(e) => setMilk(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="Bread" value={bread} onChange={(e) => setBread(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="Rent" value={rent} onChange={(e) => setRent(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="Electricity" value={electricity} onChange={(e) => setElectricity(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="Gas" value={gas} onChange={(e) => setGas(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="Salary" value={salary} onChange={(e) => setSalary(e.target.value)} className="p-3 border rounded-lg" />
              <input placeholder="Other" value={other} onChange={(e) => setOther(e.target.value)} className="p-3 border rounded-lg" />
            </div>
          </div>
        </div>
        <button type="submit" disabled={loading} className="mt-6 w-full bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-xl font-medium">
          {loading ? 'Saving...' : 'Save Manual Entry'}
        </button>
      </form>

      {/* Bulk Upload */}
      <div className="bg-white p-6 rounded-xl shadow">
        <h2 className="text-xl font-semibold mb-4">Bulk Upload (Excel / CSV)</h2>

        <div className="flex gap-4 mb-6">
          <button onClick={() => downloadTemplate('pnl')} className="flex-1 bg-green-600 text-white py-3 rounded-xl font-medium">
            📥 Download PnL Template
          </button>
          <button onClick={() => downloadTemplate('invoice')} className="flex-1 bg-purple-600 text-white py-3 rounded-xl font-medium">
            📥 Download Invoice Template
          </button>
        </div>

        <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label htmlFor="file-upload" className="cursor-pointer block">
            <div className="text-4xl mb-2">📤</div>
            <p className="font-medium">Click to select Excel / CSV file</p>
            {selectedFile && (
              <p className="mt-4 text-green-600 font-medium">
                ✅ Selected: {selectedFile.name}
              </p>
            )}
          </label>
        </div>

        <button
          onClick={handleFileUpload}
          disabled={!selectedFile || loading}
          className={`mt-6 w-full py-4 rounded-xl font-medium text-white transition-all ${
            selectedFile && !loading
              ? 'bg-blue-600 hover:bg-blue-700'
              : 'bg-gray-300 cursor-not-allowed'
          }`}
        >
          {loading ? 'Uploading...' : 'Upload File Now'}
        </button>

        {message && (
          <div className={`mt-4 p-4 rounded-xl text-center font-medium ${message.includes('✅') ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  );
}
