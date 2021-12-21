const puppeteer = require("puppeteer");
const differenceInMonths = require("date-fns/differenceInMonths");
const axios = require("axios");
const format = require("date-fns/format");

const sleep = (ms) => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};

const crawlBrands = async (categoryId) => {
  console.log(`[브랜드 조회 - ${categoryId}] 브랜드를 찾고 있습니다.`);
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
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

  await browser.close();
  console.log(
    `[브랜드 조회 - ${categoryId}] ${brands.length}개의 브랜드를 찾았습니다.`
  );
  return brands;
};

const crawlProducts = async (
  categoryId,
  startPage = 1,
  endPage = 10,
  brands = []
) => {
  console.log(
    `[상품 조회 - ${categoryId}] (${startPage}-${endPage}) 상품을 찾고 있습니다.`
  );
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const result = [];
  for (let i = startPage; i <= endPage; i++) {
    await sleep(500);
    const page = await browser.newPage();
    await page.goto(
      `https://search.shopping.naver.com/search/category?catId=${categoryId}&frm=NVSHOVS&origQuery&pagingIndex=${i}&pagingSize=80&productSet=overseas&query&sort=review&timestamp=&viewType=list`
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
            const { chnlName, nvMid } = mall;
            const apiUrl = `https://search.shopping.naver.com/api/search/rd?rank=1&pagingIndex=1&pagingSize=40&bizCd=0301&prntExpsTrtrCd=000070&cpcExtrtrCd=000072&nvMid=${nvMid}&nclickArea=lst*C&naId=&rankCatalog=3&cntCatalog=5`;
            const res = await axios.get(apiUrl);
            result.push({
              id,
              date,
              name: productTitle,
              shop: chnlName,
              url: res.data?.redirect,
              image: imageUrl,
            });
            await sleep(500);
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
          });
        }
      }
    }
    await page.close();
  }

  await browser.close();
  console.log(
    `[상품 조회 - ${categoryId}] (${startPage}-${endPage}) ${result.length}개의 상품을 찾았습니다.`
  );
  return result;
};

const crawlProductDetail = async (originalUrl) => {
  console.log(
    `[상세페이지 조회 - ${originalUrl}] 상세페이지를 조회하고 있습니다.`
  );
  const browser = await puppeteer.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.goto(originalUrl);
  await page.waitForTimeout(500);
  const scripts = await page.$$("script");

  let result = null;
  for (const script of scripts) {
    const text = await (await script.getProperty("innerText")).jsonValue();
    if (text.includes("__PRELOADED_STATE__")) {
      const state = JSON.parse(text.replace("window.__PRELOADED_STATE__=", ""));

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

  await browser.close();
  console.log(
    `[상세페이지 조회 - ${originalUrl}] 상세페이지 조회가 완료되었습니다.`
  );
  return result;
};

module.exports = {
  crawlBrands,
  crawlProducts,
  crawlProductDetail,
};
