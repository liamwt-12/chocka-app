import { describe, it, expect } from 'vitest';
import { inventedClaimProblem, promotionProblem, containsOfferFree } from './invented-claims';

describe('promotions are rejected', () => {
  it.each([
    '20% off all carpets this month.',
    'Up to 30 % off selected vinyl.',
    'Twenty per cent off when you book this week.',
    'Everything is half price in the showroom.',
    'Half-price underlay with every carpet.',
    'We are running a discount on laminate.',
    'Discounted rugs while they last.',
    'Our winter sale is on now.',
    'Don\'t miss the January sales at the showroom.',
    'Big clearance on end-of-line rolls.',
    'A special offer on stair runners this month.',
    'Our autumn deals are here.',
    'This month\'s offer: a new hallway for less.',
    'For a limited time only.',
    'Offer ends Sunday.',
    'Offers valid until the end of the month.',
    'The offer runs until Friday.',
    'Available while stocks last.',
    'Buy one rug, get one half off.',
    'Two rooms for the price of one.',
    'Money off every order.',
    'Save up to a third on vinyl.',
    'Price cuts across the range.',
    'Reduced prices on wood flooring.',
    'Use our promo code at the counter.',
    'A seasonal promotion on carpets.',
    'Bring this voucher to the shop.',
  ])('%s', (text) => {
    expect(inventedClaimProblem(text)).toBe('contains offer or discount');
  });

  it.each([
    'We offer a wide range of carpets and vinyl.',
    'The showroom offers plenty of choice for every room.',
    'There is a huge range on offer in the showroom.',
    'Pop in and talk to our sales team.',
    'Great after-sales care from the people who fitted it.',
    'A great deal of choice for busy hallways.',
    'Autumn is a good moment to freshen up a tired hallway.',
  ])('allows: %s', (text) => {
    expect(inventedClaimProblem(text)).toBeNull();
  });
});

describe('"free" is rejected as an offer, allowed where it is not one', () => {
  it.each([
    'Free quotes for every room.',
    'Free fitting on all carpets.',
    'Free delivery across the county.',
    'Ask for free samples.',
    'Measuring is free.',
    'We measure up free of charge.',
    'Interest-free credit available.',
    'A no-obligation, cost-free visit.',
    'Risk free returns.',
    'Get a FREE home visit.',
  ])('%s', (text) => {
    expect(containsOfferFree(text)).toBe(true);
    expect(inventedClaimProblem(text)).toBe('contains free offer');
  });

  it.each([
    'Feel free to pop in and have a look.',
    'A hassle-free way to refresh a room.',
    'Hassle free and quick.',
    'Mess-free fitting by people who care.',
    'Stress free from start to finish.',
    'A free-standing display of samples.',
    'Freestanding sample racks in the showroom.',
    'Slip-free and easy to clean.',
    'Hands-free browsing in the showroom.',
    'Freedom to choose the right floor.',
  ])('allows: %s', (text) => {
    expect(containsOfferFree(text)).toBe(false);
    expect(inventedClaimProblem(text)).toBeNull();
  });

  it('a harmless "free" does not hide an offer elsewhere in the text', () => {
    expect(inventedClaimProblem('Feel free to ask about free fitting.')).toBe('contains free offer');
    expect(inventedClaimProblem('A hassle-free, free quote.')).toBe('contains free offer');
  });
});

describe('awards and rankings are rejected', () => {
  it.each([
    'Our award-winning team is ready to help.',
    'We are proud of our awards.',
    'We were awarded a regional prize.',
    'Winner of the local business prize.',
    'Voted the best flooring shop in town.',
    'Named number one by local readers.',
    'The No. 1 choice for carpets.',
    'The #1 flooring shop around.',
    'A top-rated showroom.',
  ])('%s', (text) => {
    expect(inventedClaimProblem(text)).toBe('contains award claim');
  });

  it.each([
    'A rewarding way to transform your home.',
    'Winter is coming, so think about warm floors.',
  ])('allows: %s', (text) => {
    expect(inventedClaimProblem(text)).toBeNull();
  });
});

describe('customer stories and testimonials are rejected', () => {
  it.each([
    'We just fitted a lovely stair runner.',
    'We\'ve recently finished a hallway in oak.',
    'We recently completed a kitchen floor.',
    'Last week, we laid a new carpet in a bungalow.',
    'A new floor for a customer in the village.',
    'A stair runner for one of our regular customers.',
    'One of our customers chose a striking herringbone.',
    'We helped a young family in Testtown choose a carpet.',
    'A couple from Sampleton picked luxury vinyl.',
    'Mrs Smith loves her new hallway.',
    'Mr. Jones picked a grey carpet.',
    'Our customers said it was the right decision.',
    'Read our testimonials.',
    'As one homeowner put it, "the hallway looks brand new now".',
    'She told us “it was all so easy from start to finish”.',
  ])('%s', (text) => {
    expect(inventedClaimProblem(text)).toBe('contains customer story');
  });

  it.each([
    'Hard-wearing carpet is perfect for a family home.',
    'Families across Testtown choose vinyl for busy kitchens.',
    'We help customers choose the right floor for each room.',
    'Pop in to the showroom and have a look.',
    'Try the "LVT" range.',
  ])('allows: %s', (text) => {
    expect(inventedClaimProblem(text)).toBeNull();
  });
});

describe('promotionProblem (the voice questions) leaves stories out', () => {
  it('catches offers, free and awards, but not story wording', () => {
    expect(promotionProblem('free fitting')).toBe('contains free offer');
    expect(promotionProblem('10% off')).toBe('contains offer or discount');
    expect(promotionProblem('award-winning')).toBe('contains award claim');
    expect(promotionProblem('one of our customers')).toBeNull();
  });
});
