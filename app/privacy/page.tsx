import { getRequestTenant } from '@/lib/tenant-request';

// Resolved per request, not per process: this page names the data controller a
// retailer is consenting to, so it has to match the brand they arrived through.
export default function PrivacyPage() {
  const t = getRequestTenant();
  // This policy was written for a paid subscription. On a free tenant the
  // billing passages are not merely irrelevant, they are inaccurate: there is no
  // Stripe customer, no payment processing and no billing record, so naming
  // Stripe as a processor tells a retailer their data goes somewhere it does not.
  const paid = t.priceMonthlyGbp > 0;
  // Set only where retailer records were obtained from a third party's list
  // rather than from the retailer — see Tenant.dataSource. Undefined on Chocka,
  // which renders none of the two sections below and is unchanged by this file.
  const src = t.dataSource;
  return (
    <div className="max-w-2xl mx-auto px-6 py-16">
      <a href="/" className="text-brand font-extrabold text-xl">{t.brandName}</a>
      <h1 className="text-3xl font-extrabold text-charcoal mt-8 mb-8">Privacy Policy</h1>

      <div className="prose prose-gray text-sm leading-relaxed text-gray-500 space-y-6">
        <p>Last updated: March 2026</p>

        <p>
          {t.brandName} (&quot;we&quot;, &quot;our&quot;, &quot;us&quot;) is operated by {t.legalEntity}. This policy explains what data we
          collect, how we use it, and your rights under UK GDPR.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">What we collect</h2>
        <p>
          When you sign up, we collect your name, email address, and phone number via Google OAuth.
          We access your Google Business Profile data (business name, address, reviews, performance metrics)
          to provide our service.{paid && ' We store your Stripe customer ID for billing.'}
          {!paid && ` ${t.brandName} is free to you${t.fundedBy ? `, funded by ${t.fundedBy}` : ''}, so we hold no payment details of any kind.`}
        </p>

        {src && (
          <>
            <h2 className="text-lg font-bold text-charcoal mt-8">Where your business details came from</h2>
            <p>
              We held a record about your business before you signed up, and you did not give it to
              us. You are entitled to know that, and to know where it came from.
            </p>
            <p>
              In {src.obtained} we took a copy of{' '}
              <a href={src.url} className="underline" target="_blank" rel="noopener noreferrer">
                {src.holder}&apos;s {src.description}
              </a>
              . From it we hold {src.fields}.
            </p>
            <p>
              We then looked up your Google Business Profile and recorded {src.derived}. We keep
              those figures and the dates we measured them. None of this came from you, and the
              score is our own assessment — Google does not publish it and neither does {src.holder}.
            </p>
            <p>
              <strong className="text-charcoal">Our lawful basis is legitimate interests.</strong> We
              need to know which retailers are in {src.holder}&apos;s network, and how their Google
              listings are performing, in order to provide the service {src.holder} funds for them.
              We have weighed that against your rights and recorded the assessment. You can object at
              any time and we will remove your record — you do not need to give a reason, and you do
              not need to have an account.
            </p>
            <p>
              We keep it {src.retention}. You can ask us to delete it at any point and we will —
              that request we act on straight away.
            </p>
            {/* Article 14(1)(e) — recipients. The generic processor list further
                down does not answer the question a retailer actually has, which
                is what their own supplier gets to see. Wording matches the
                confirmed /terms section. */}
            <p>
              <strong className="text-charcoal">What {src.holder} sees.</strong> {src.holder} is told
              how many retailers are using the service, because that is what it is invoiced for. It
              is not given your score, your rating, your reviews, your performance figures or your
              contact details by us. Your record came from {src.holder}&apos;s own published list in
              the first place, so nothing in it is new to them — but the assessment we made of your
              listing is ours, and we do not hand it back.
            </p>
            {/* Article 14(2)(g) — automated decision-making. There is none of the
                kind that engages Article 22, and saying so is better than silence. */}
            <p>
              We do not make automated decisions about you that have legal or similarly significant
              effects. The score is our assessment of a public listing, not a decision about you, and
              nothing is decided automatically on the strength of it.
            </p>
            {/*
              The lawful basis stated above is the conclusion of
              LEGITIMATE_INTERESTS_ASSESSMENT.md, which records the three-part
              test rather than asserting the answer. Note what it covers and what
              it does NOT: holding and scoring the record only. It does not
              support marketing email, which fails the necessity limb and is
              separately gated by PECR. Nothing on this page may be read as a
              basis for contacting a retailer to sell them something.
            */}
          </>
        )}

        <h2 className="text-lg font-bold text-charcoal mt-8">How we use your data</h2>
        <p>
          We use your data solely to provide the {t.brandName} service: posting to your Google profile,
          replying to reviews, sending you SMS notifications, and generating performance reports.
          We do not sell your data to third parties. We do not use your data for advertising.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">Third-party services</h2>
        <p>
          We use Supabase (database), {paid && 'Stripe (payments), '}Twilio (SMS), Resend (email), Google APIs
          (business profile management), and Anthropic (AI-generated content). Each processes data
          according to their own privacy policies.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">Data retention</h2>
        <p>
          We retain your data while your account is active. When you delete your account, your
          account and everything attached to it — your profile, your reviews, your posts and your
          stats — is permanently removed within 30 days.
          {paid && ' Stripe may retain billing records as required by law.'}
        </p>
        {src && (
          <p>
            {/*
              The old single sentence promised that deleting an account removed
              "all your data". For a retailer on this tenant that is not true, and
              the schema is explicit about it: retailers.user_id is
              `on delete set null`, not cascade, so the record and its score
              history deliberately survive the account. A policy that promises an
              erasure the system does not perform is worse than one that explains
              the split, so this says plainly what stays and how to get rid of it.
            */}
            <strong className="text-charcoal">The record described above is separate from your account</strong>{' '}
            and is not deleted with it. It existed before you signed up and, by default, remains
            afterwards — that is deliberate, because it is a record of {src.holder}&apos;s retailer
            network rather than of your use of {t.brandName}. If you want it erased as well, email{' '}
            {t.privacyEmail} and we will remove it. You do not have to have an account, or ever have
            had one, to ask.
          </p>
        )}

        <h2 className="text-lg font-bold text-charcoal mt-8">Your rights</h2>
        <p>
          Under UK GDPR you have the right to access, correct, delete, and export your data.
          You can delete your account from Settings at any time. For other requests, email
          {' '}{t.privacyEmail}.
          {src && (
            <>
              {' '}Because we did not obtain your business details from you, you also have the right
              to object to us holding them at all — separately from anything to do with an account.
              Email the same address and say so; we do not require a reason.
            </>
          )}
        </p>
        {/*
          Article 13(2)(d) and 14(2)(e) BOTH require telling people they can
          complain to the supervisory authority, so this was a mandatory element
          missing for every tenant — not only the one with a data-source notice.
          Rendered unconditionally, which does change Chocka's page.
        */}
        <p>
          You also have the right to complain to the Information Commissioner&apos;s Office, the UK
          data protection regulator, at{' '}
          <a href="https://ico.org.uk/make-a-complaint/" className="underline" target="_blank" rel="noopener noreferrer">
            ico.org.uk/make-a-complaint
          </a>
          . We would rather you raised it with us first, but you are not required to.
        </p>

        <h2 className="text-lg font-bold text-charcoal mt-8">Contact</h2>
        <p>
          {t.legalEntity} · {t.supportEmail}
        </p>
      </div>
    </div>
  );
}
