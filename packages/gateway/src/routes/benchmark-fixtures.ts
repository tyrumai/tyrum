import { Hono } from "hono";
import { BENCHMARK_MERCHANT_SITE_PATH, BENCHMARK_PUBLIC_BASE_URL_PATH } from "@tyrum/contracts";

function renderBenchmarkMerchantSite(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Benchmark Pizza Checkout</title>
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", sans-serif;
        background: #f8f4ec;
        color: #1f1b16;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background:
          radial-gradient(circle at top, rgba(255, 205, 130, 0.45), transparent 34%),
          linear-gradient(180deg, #fff7e8 0%, #f3ead7 100%);
      }
      main {
        max-width: 900px;
        margin: 0 auto;
        padding: 40px 20px 64px;
      }
      .hero {
        margin-bottom: 24px;
        padding: 28px;
        border-radius: 24px;
        background: #20130b;
        color: #fff8ef;
        box-shadow: 0 18px 40px rgba(32, 19, 11, 0.24);
      }
      .hero h1 {
        margin: 0 0 10px;
        font-size: 2.4rem;
      }
      .hero p {
        margin: 0;
        max-width: 42rem;
        line-height: 1.5;
      }
      .layout {
        display: grid;
        gap: 20px;
        grid-template-columns: 2fr 1fr;
      }
      .panel {
        padding: 22px;
        border-radius: 22px;
        background: rgba(255, 252, 246, 0.92);
        box-shadow: 0 12px 28px rgba(78, 52, 24, 0.1);
      }
      h2 {
        margin-top: 0;
      }
      form {
        display: grid;
        gap: 16px;
      }
      label,
      fieldset {
        display: grid;
        gap: 8px;
        padding: 0;
        margin: 0;
        border: 0;
      }
      input,
      select,
      button {
        font: inherit;
      }
      input,
      select {
        padding: 12px 14px;
        border: 1px solid #d3b991;
        border-radius: 14px;
        background: #fffdf8;
      }
      .inline-grid {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
      .choices {
        display: grid;
        gap: 10px;
      }
      .choice {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 12px;
        border: 1px solid #ecd6b0;
        border-radius: 14px;
        background: #fffaf1;
      }
      button {
        padding: 14px 18px;
        border: 0;
        border-radius: 999px;
        background: #c24b1d;
        color: #fff8ef;
        font-weight: 700;
        cursor: pointer;
      }
      button:hover {
        background: #a73f17;
      }
      #form-error {
        min-height: 1.5rem;
        color: #a11111;
      }
      #confirmation {
        display: grid;
        gap: 10px;
      }
      #confirmation[hidden] {
        display: none;
      }
      .detail-row {
        margin: 0;
      }
      .detail-row strong {
        display: inline-block;
        min-width: 8rem;
      }
      ul {
        padding-left: 1.25rem;
        margin-bottom: 0;
      }
      @media (max-width: 760px) {
        .layout,
        .inline-grid {
          grid-template-columns: 1fr;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <h1>Benchmark Pizza</h1>
        <p>
          Sandbox-reachable benchmark merchant. Complete checkout here instead of using public
          search engines or third-party marketplaces.
        </p>
      </section>
      <div class="layout">
        <section class="panel">
          <h2>Checkout</h2>
          <form id="order-form">
            <label for="delivery-address">
              Delivery address
              <input
                id="delivery-address"
                name="deliveryAddress"
                autocomplete="street-address"
                placeholder="123 Benchmark Lane, Testville, CA 94000"
                required
              />
            </label>

            <div class="inline-grid">
              <label for="pizza-size">
                Pizza size
                <select id="pizza-size" name="pizzaSize">
                  <option value="small">Small</option>
                  <option value="medium">Medium</option>
                  <option value="large" selected>Large</option>
                </select>
              </label>

              <label for="pizza-crust">
                Crust
                <select id="pizza-crust" name="pizzaCrust">
                  <option value="thick">Thick crust</option>
                  <option value="thin" selected>Thin crust</option>
                  <option value="gluten-free">Gluten free</option>
                </select>
              </label>
            </div>

            <fieldset>
              <legend>Toppings</legend>
              <div class="choices">
                <label class="choice" for="topping-pepperoni">
                  <input
                    id="topping-pepperoni"
                    name="pepperoni"
                    type="checkbox"
                    checked
                  />
                  Pepperoni
                </label>
                <label class="choice" for="topping-mushrooms">
                  <input id="topping-mushrooms" name="mushrooms" type="checkbox" />
                  Mushrooms
                </label>
                <label class="choice" for="topping-olives">
                  <input id="topping-olives" name="olives" type="checkbox" checked />
                  Olives
                </label>
              </div>
            </fieldset>

            <label for="card-name">
              Cardholder name
              <input id="card-name" name="cardName" autocomplete="cc-name" required />
            </label>

            <label for="card-number">
              Card number
              <input id="card-number" name="cardNumber" autocomplete="cc-number" required />
            </label>

            <div class="inline-grid">
              <label for="card-expiry">
                Expiry
                <input
                  id="card-expiry"
                  name="cardExpiry"
                  autocomplete="cc-exp"
                  placeholder="MM/YY"
                  required
                />
              </label>

              <label for="card-cvc">
                CVC
                <input
                  id="card-cvc"
                  name="cardCvc"
                  autocomplete="cc-csc"
                  placeholder="123"
                  required
                />
              </label>
            </div>

            <button id="place-order" type="submit">Place Order</button>
            <p id="form-error" role="alert" aria-live="polite"></p>
          </form>

          <section id="confirmation" hidden>
            <h2>Order confirmed</h2>
            <p class="detail-row"><strong>Merchant:</strong> Benchmark Pizza</p>
            <p class="detail-row"><strong>Order ID:</strong> BP-20260410-0001</p>
            <p class="detail-row"><strong>ETA:</strong> 35-45 minutes</p>
            <p class="detail-row">
              <strong>Basket:</strong>
              Large thin-crust pepperoni pizza with mushrooms and no olives
            </p>
            <p class="detail-row">
              <strong>Deliver to:</strong>
              <span id="confirmation-address"></span>
            </p>
          </section>
        </section>

        <aside class="panel">
          <h2>Benchmark notes</h2>
          <ul>
            <li>The target order is a large thin-crust pepperoni pizza.</li>
            <li>Add mushrooms.</li>
            <li>Do not include olives.</li>
            <li>Payment fields must be completed before the order can be submitted.</li>
          </ul>
        </aside>
      </div>
    </main>

    <script>
      const form = document.getElementById("order-form");
      const formError = document.getElementById("form-error");
      const confirmation = document.getElementById("confirmation");
      const confirmationAddress = document.getElementById("confirmation-address");

      function readInput(id) {
        const element = document.getElementById(id);
        return element instanceof HTMLInputElement || element instanceof HTMLSelectElement
          ? element
          : null;
      }

      function normalizeDigits(value) {
        return value.replace(/[^0-9]/g, "");
      }

      form.addEventListener("submit", (event) => {
        event.preventDefault();
        formError.textContent = "";

        const deliveryAddress = readInput("delivery-address");
        const pizzaSize = readInput("pizza-size");
        const pizzaCrust = readInput("pizza-crust");
        const pepperoni = readInput("topping-pepperoni");
        const mushrooms = readInput("topping-mushrooms");
        const olives = readInput("topping-olives");
        const cardName = readInput("card-name");
        const cardNumber = readInput("card-number");
        const cardExpiry = readInput("card-expiry");
        const cardCvc = readInput("card-cvc");

        if (
          !deliveryAddress ||
          !pizzaSize ||
          !pizzaCrust ||
          !pepperoni ||
          !mushrooms ||
          !olives ||
          !cardName ||
          !cardNumber ||
          !cardExpiry ||
          !cardCvc
        ) {
          formError.textContent = "Checkout form is unavailable.";
          return;
        }

        const paymentReady =
          cardName.value.trim().length > 0 &&
          normalizeDigits(cardNumber.value).length >= 12 &&
          cardExpiry.value.trim().length >= 4 &&
          normalizeDigits(cardCvc.value).length >= 3;

        const orderMatchesBenchmark =
          pizzaSize.value === "large" &&
          pizzaCrust.value === "thin" &&
          pepperoni.checked &&
          mushrooms.checked &&
          !olives.checked;

        if (!deliveryAddress.value.trim()) {
          formError.textContent = "Enter a delivery address.";
          return;
        }
        if (!orderMatchesBenchmark) {
          formError.textContent =
            "Benchmark order must be a large thin-crust pepperoni pizza with mushrooms and no olives.";
          return;
        }
        if (!paymentReady) {
          formError.textContent = "Complete the payment fields before placing the order.";
          return;
        }

        confirmationAddress.textContent = deliveryAddress.value.trim();
        form.hidden = true;
        confirmation.hidden = false;
      });
    </script>
  </body>
</html>`;
}

export function createBenchmarkFixtureRoutes(input: { publicBaseUrl: string }): Hono {
  const app = new Hono();

  app.get(BENCHMARK_MERCHANT_SITE_PATH, (c) => {
    c.header("cache-control", "no-store");
    return c.html(renderBenchmarkMerchantSite());
  });

  app.get(BENCHMARK_PUBLIC_BASE_URL_PATH, (c) => {
    c.header("cache-control", "no-store");
    return c.json({ public_base_url: input.publicBaseUrl });
  });

  return app;
}
