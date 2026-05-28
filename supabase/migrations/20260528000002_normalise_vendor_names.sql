UPDATE invoice_items SET vendor = 'Zomato Hyperpure Private Limited'
WHERE restaurant_id = 'b77ed758-9a72-4de2-9138-b353589c656d'
  AND (vendor ILIKE '%hyperpure%' OR (vendor ILIKE '%zomato%' AND vendor NOT ILIKE '%swiggy%'));

UPDATE invoice_items SET vendor = 'BigBasket Now'
WHERE restaurant_id = 'b77ed758-9a72-4de2-9138-b353589c656d'
  AND (vendor ILIKE '%bigbasket%' OR vendor ILIKE '%bbnow%' OR
       vendor ILIKE '%bb now%' OR vendor ILIKE '%innovative retail%');

UPDATE invoice_items SET vendor = 'DMart'
WHERE restaurant_id = 'b77ed758-9a72-4de2-9138-b353589c656d'
  AND (vendor ILIKE '%dmart%' OR vendor ILIKE '%avenue e-commerce%' OR
       vendor ILIKE '%avenue e commerce%');
