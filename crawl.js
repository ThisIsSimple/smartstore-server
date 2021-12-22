const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const differenceInMonths = require("date-fns/differenceInMonths");
const axios = require("axios");
const format = require("date-fns/format");

puppeteer.use(StealthPlugin()); // Add stealth plugin and use defaults (all tricks to hide puppeteer usage)

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

let browser = null;
puppeteer
  .launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  })
  .then((b) => {
    console.log("BROWSER CREATED");
    browser = b;
  });

const crawlBrands = async (categoryId) => {
  if (!browser) return false;
  console.log(`[브랜드 조회 - ${categoryId}] 브랜드를 찾고 있습니다.`);
  const page = await browser.newPage();

  await page.goto(
    `https://search.shopping.naver.com/search/category?catId=${categoryId}&frm=NVSHOVS&pagingIndex=1&pagingSize=20&productSet=overseas`
  );
  await page.waitForSelector(
    "#__next > div > div.style_container__1YjHN > div > div.filter_finder__1Gtei > div.filter_finder_filter__1DTIN > div.filter_finder_col__3ttPW.filter_is_active__3qqoC > div.filter_finder_row__1rXWv > div > h4 > a"
  );

  // 브랜드 필터링
  const brands = [];
  const brandFilter = await page.$(
    "#__next > div > div.style_container__1YjHN > div > div.filter_finder__1Gtei > div.filter_finder_filter__1DTIN > div.filter_finder_col__3ttPW.filter_is_fixed__1i_lw"
  );
  const brandFilterExtendButton = await brandFilter.$(
    ".filter_finder_tit__2VCKd > .filter_btn_extend__31sOH"
  );
  await brandFilterExtendButton.click();
  const brandListItems = await brandFilter.$$(
    ".filter_finder_list__16XU5 > li"
  );
  for (const brandListItem of brandListItems) {
    const brand = await brandListItem.$eval(
      ".filter_text_over__3zD9c",
      (el) => el.innerHTML
    );
    brands.push(brand);
  }

  await page.close();
  console.log(
    `[브랜드 조회 - ${categoryId}] ${brands.length}개의 브랜드를 찾았습니다.`
  );
  return brands;
};

const crawlProducts = async (
  categoryId,
  startPage = 1,
  endPage = 10,
  brands = [],
  sort = "rel"
) => {
  if (!browser) return false;
  console.log(
    `[상품 조회 - ${categoryId}] (${startPage}-${endPage}) 상품을 찾고 있습니다.`
  );
  const result = [];
  for (let i = startPage; i <= endPage; i++) {
    console.log(
      `[상품 조회 - ${categoryId}, ${sort}] 페이지 (${i}/${endPage})...`
    );
    await sleep(100);
    const page = await browser.newPage();
    try {
      await page.goto(
        `https://search.shopping.naver.com/search/category?catId=${categoryId}&frm=NVSHOVS&origQuery&pagingIndex=${i}&pagingSize=80&productSet=overseas&query&sort=${sort}&timestamp=&viewType=list`
      );
      await page.waitForSelector("#__NEXT_DATA__");

      const pageData = await page.$eval("#__NEXT_DATA__", (el) => el.innerText);
      const productData =
        JSON.parse(pageData).props.pageProps.initialState.products.list;
      const products = productData.map((p) => p.item);

      for (const p of products) {
        const { id, openDate, brand, productTitle, imageUrl, lowMallList } = p;

        // 1. 브랜드 상품이 아닌 것
        // 2. 3개월 이내 등록된 것
        const registerDate = new Date(
          `${openDate.slice(0, 4)}.${openDate.slice(4, 6)}`
        );
        const date = `${openDate.slice(0, 4)}.${openDate.slice(4, 6)}`;
        if (
          brands.some((b) => brand.includes(b)) ||
          brands.some((b) => productTitle.includes(b)) ||
          differenceInMonths(new Date(), registerDate) > 3
        )
          continue;

        // 3. 네이버스토어에 등록된 것
        // 3-1. 다른 몰 같이 있는 것 (lowMallList)
        if (p.lowMallList) {
          for (const mall of lowMallList) {
            // 스마트스토어 상품
            const { chnlSeq, chnlType } = mall;
            if (chnlSeq !== "" && chnlType === "STOREFARM") {
              try {
                const { chnlName, nvMid } = mall;
                const apiUrl = `https://search.shopping.naver.com/api/search/rd?rank=1&pagingIndex=1&pagingSize=40&bizCd=0301&prntExpsTrtrCd=000070&cpcExtrtrCd=000072&nvMid=${nvMid}&nclickArea=lst*C&naId=&rankCatalog=3&cntCatalog=5`;
                const res = await axios.get(apiUrl);
                if (!res.data?.redirect)
                  throw "스마트스토어 주소를 찾지 못했습니다.";
                result.push({
                  id,
                  date,
                  name: productTitle,
                  shop: chnlName,
                  url: res.data?.redirect,
                  image: imageUrl,
                  page: i,
                });
              } catch (e) {
                console.log(
                  `[ERROR] [${categoryId}] ${i}페이지 ${productTitle} 스마트스토어 주소 수집에 실패했습니다.`
                );
              }
              await sleep(200);
              break;
            }
          }
        }
        // 3-2. 혼자인 것 (mallInfoCache)
        else {
          const { mallName, mallProductUrl } = p;
          // 스마트스토어 상품
          if (mallProductUrl.includes("smartstore")) {
            result.push({
              id,
              date,
              name: productTitle,
              shop: mallName,
              url: mallProductUrl,
              image: imageUrl,
              page: i,
            });
          }
        }
      }
    } catch (e) {
      console.log(`[ERROR] [${categoryId}] ${i} 페이지 수집에 실패하였습니다.`);
    }
    await page.close();
  }

  console.log(
    `[상품 조회 - ${categoryId}] (${startPage}-${endPage}) ${result.length}개의 상품을 찾았습니다.`
  );
  return result;
};

const crawlProductDetail = async (originalUrl) => {
  if (!browser) return false;
  console.log(
    `[상세페이지 조회 - ${originalUrl}] 상세페이지를 조회하고 있습니다.`
  );
  let result = null;

  if (!originalUrl) {
    console.log("주소가 없습니다.");
    return false;
  }
  const page = await browser.newPage();
  try {
    await sleep(50);
    await page.goto(originalUrl);
    const scripts = await page.$$("script");

    for (const script of scripts) {
      const text = await (await script.getProperty("innerText")).jsonValue();
      if (text.includes("__PRELOADED_STATE__")) {
        const state = JSON.parse(
          text.replace("window.__PRELOADED_STATE__=", "")
        );

        const { category, name, productUrl, channel, saleAmount } =
          state.product.A;
        const regDate = state.smartStoreV2.displayConfig.createdDate;
        const { wholeCategoryName } = category;
        const { channelName } = channel;
        const { cumulationSaleCount } = saleAmount;

        const date = format(new Date(regDate), "y.MM.");
        result = {
          category: wholeCategoryName,
          name,
          shop: channelName,
          url: productUrl,
          date,
          count: cumulationSaleCount,
        };
        break;
      }
    }
    console.log(
      `[상세페이지 조회 - ${originalUrl}] 상세페이지 조회가 완료되었습니다.`
    );
  } catch (e) {
    console.log(e);
    console.error(e);
  }
  await page.close();
  return result;
};

module.exports = {
  browser,
  crawlBrands,
  crawlProducts,
  crawlProductDetail,
};
