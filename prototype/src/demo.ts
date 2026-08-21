import { evaluatePurchase, serializeRecommendation } from "./engine.ts";

for (const residualValueJpyPerUnit of ["0.95", "1.00"]) {
  console.log(
    JSON.stringify(
      serializeRecommendation(
        evaluatePurchase({
          amountJpy: 640,
          residualValueJpyPerUnit,
          pointCardPresented: false,
          campaignEnrolled: false,
        }),
      ),
      null,
      2,
    ),
  );
}
