'use client';

import { useState } from 'react';

export default function BackfillWizard() {
  const [restaurantId] = useState('b77ed758-9a72-4de2-9138-b353589c656d'); // your restaurant ID
  const [date, setDate] = useState('');
  const [sales, setSales] = useState('');
  const [hyperpure, setHyperpure] = useState('');
  const [bigbasket, setBigbasket] = useState('');
  const [other, setOther] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage('');

    const totals: any = {};
    if (sales) totals.sales = parseFloat(sales);
    if (hyperpure) totals.hyperpure = parseFloat(hyperpure);
    if (bigbasket) totals.bigbasket = parseFloat(bigbasket);
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
        setSales('');
        setHyperpure('');
        setBigbasket('');
        setOther('');
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
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-2">Backfill Wizard</h1>
      <p className="text-gray-600 mb-8">Quickly add historical data for your restaurant</p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <div>
          <label className="block text-sm font-medium mb-1">Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-4 py-3"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Sales / Revenue</label>
            <input
              type="number"
              value={sales}
              onChange={(e) => setSales(e.target.value)}
              placeholder="3500"
              className="w-full border border-gray-300 rounded-lg px-4 py-3"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Hyperpure</label>
            <input
              type="number"
              value={hyperpure}
              onChange={(e) => setHyperpure(e.target.value)}
              placeholder="2400"
              className="w-full border border-gray-300 rounded-lg px-4 py-3"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">BigBasket</label>
            <input
              type="number"
              value={bigbasket}
              onChange={(e) => setBigbasket(e.target.value)}
              placeholder="1650"
              className="w-full border border-gray-300 rounded-lg px-4 py-3"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">Other / Metro / Instamart</label>
            <input
              type="number"
              value={other}
              onChange={(e) => setOther(e.target.value)}
              placeholder="800"
              className="w-full border border-gray-300 rounded-lg px-4 py-3"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-4 rounded-xl disabled:opacity-50"
        >
          {loading ? 'Saving...' : 'Save Backfill Entry'}
        </button>
      </form>

      {message && (
        <div className="mt-6 p-4 bg-gray-100 rounded-xl text-center">
          {message}
        </div>
      )}
    </div>
  );
}
