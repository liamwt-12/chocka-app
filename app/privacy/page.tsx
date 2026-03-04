export default function PrivacyPage() {
  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <a href="/" className="text-brand font-extrabold text-xl">Chocka</a>
      <h1 className="text-3xl font-extrabold text-charcoal mt-8 mb-8">Privacy Policy</h1>

      <div className="prose prose-gray text-sm leading-relaxed text-gray-500 space-y-6">
        <p>Last updated: March 2026</p>

        <p>
          Chocka (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) is operated by Useful for Humans Ltd. This policy explains what data we
          collect, how we use it, and your rights under UK GDPR.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">What we collect</h2>
        <p>
          When you sign up, we collect your name, email address, and phone number via Google OAuth.
          We access your Google Business Profile data (business name, address, reviews, performance metrics)
          to provide our service. We store your Stripe customer ID for billing.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">How we use your data</h2>
        <p>
          We use your data solely to provide the Chocka service: posting to your Google profile,
          replying to reviews, sending you SMS notifications, and generating performance reports.
          We do not sell your data to third parties. We do not use your data for advertising.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">Third-party services</h2>
        <p>
          We use Supabase (database), Stripe (payments), Twilio (SMS), Resend (email), Google APIs
          (business profile management), and Anthropic (AI-generated content). Each processes data
          according to their own privacy policies.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">Data retention</h2>
        <p>
          We retain your data while your account is active. When you delete your account, all your
          data is permanently removed within 30 days. Stripe may retain billing records as required
          by law.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">Your rights</h2>
        <p>
          Under UK GDPR you have the right to access, correct, delete, and export your data.
          You can delete your account from Settings at any time. For other requests, email
          privacy@chocka.co.uk.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">Contact</h2>
        <p>
          Useful for Humans Ltd · hello@chocka.co.uk
        </p>
      </div>
    </div>
  );
}
