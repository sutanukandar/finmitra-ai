'use client';

import { useState } from 'react';

export default function BackfillWizard() {
  const [restaurantId] = useState('b77ed758-9a72-4de2-9138-b353589c656d'); // Your restaurant ID
  const [date, setDate] = useState('');
  
  // Revenue Section
  const [salesQR, setSalesQR] = useState('');
  const [salesCash, setSalesCash] = useState('');
  const [swiggy, setSwiggy] = useState('');
  const [zomato, setZomato] = useState('');

  // Expenses Section
  const [hyperpure, setHyperpure] = useState('');
  const [bigbasket, setBigbasket] = useState('');
  const [milk, setMilk] = useState('');
  const [bread, setBread] = useState('');
  const [rent, setRent] = useState('');
  const [electricity, setElectricity] = useState('');
  const [gas, setGas] = useState('');
  const [salary, setSalary] = useState('');
  const [other, setOther] = useState('');

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const totals: any = {};

    // Revenue
    if (salesQR) totals.sales = (parseFloat(salesQR) || 0) + (parseFloat(salesCash) || 0);
    if (swiggy) totals.swiggy = parseFloat(swiggy);
    if (zomato) totals.zomato = parseFloat(zomato);   // You can add zomato column later if needed

    // Expenses
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
      entries: [{
        date: date,
        totals: totals
      }]
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
        // Clear form
        setSalesQR(''); setSalesCash(''); setSwiggy(''); setZomato('');
        setHyperpure(''); setBigbasket(''); setMilk(''); setBread('');
        setRent(''); setElectricity(''); setGas(''); setSalary(''); setOther('');
      } else {
        setMessage('❌ Error: ' + (data.error || 'Unknown error'));
      }
    } catch (err) {
      setMessage('❌ Failed to connect to server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-1">Backfill Wizard</h1>
      <p className="text-gray-600 mb-8">Quickly add historical data for your restaurant</p>

      <form onSubmit={handleSubmit} className="space-y-10">
        {/* Date */}
        <div>
          <label className="block text-sm font-medium mb-2">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-300 rounded-xl px-5 py-4 text-lg"
            required
          />
        </div>

        {/* Revenue Section */}
        <div>
          <h2 className="text-xl font-semibold mb-4 text-green-700">Revenue / Sales</h2>
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium mb-2">Sales (QR)</label>
              <input type="number" value={salesQR} onChange={(e) => setSalesQR(e.target.value)} placeholder="2500" className="w-full border border-gray-300 rounded-xl px-5 py-4" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Sales (Cash)</label>
              <input type="number" value={salesCash} onChange={(e) => setSalesCash(e.target.value)} placeholder="1000" className="w-full border border-gray-300 rounded-xl px-5 py-4" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Swiggy / Online Delivery</label>
              <input type="number" value={swiggy} onChange={(e) => setSwiggy(e.target.value)} placeholder="800" className="w-full border border-gray-300 rounded-xl px-5 py-4" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Zomato / Online Delivery</label>
              <input type="number" value={zomato} onChange={(e) => setZomato(e.target.value)} placeholder="600" className="w-full border border-gray-300 rounded-xl px-5 py-4" />
            </div>
          </div>
        </div>

        {/* Expenses Section */}
        <div>
          <h2 className="text-xl font-semibold mb-4 text-red-700">Expenses</h2>
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

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-5 rounded-2xl text-lg disabled:opacity-50"
        >
          {loading ? 'Saving Backfill...' : 'Save Backfill Entry'}
        </button>
      </form>

      {message && (
        <div className="mt-8 p-5 bg-gray-100 rounded-2xl text-center text-lg">
          {message}
        </div>
      )}
    </div>
  );
}
