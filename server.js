const app = require("express")();
const http = require("http");
const cors = require("cors");
const bodyParser = require("body-parser");
const {
  browser,
  crawlBrands,
  crawlProducts,
  crawlProductDetail,
} = require("./crawl");
const { webLogger } = require("./logger");

const server = http.createServer(app);

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.get("/api/brands/:categoryId", async (req, res) => {
  const { categoryId } = req.params;
  try {
    const brands = await crawlBrands(categoryId);
    res.status(200).json(brands);
  } catch (e) {
    webLogger(req, e);
    res.status(500).json({ status: "error" });
  }
});

app.post("/api/products/:categoryId", async (req, res) => {
  const { categoryId } = req.params;
  const { startPage, endPage, brandString, sort } = req.body;
  let brands = [];
  if (brandString) {
    brands = brandString.split(",");
  }
  try {
    const products = await crawlProducts(
      categoryId,
      startPage ? Number(startPage) : 1,
      endPage ? Number(endPage) : 10,
      brands,
      sort
    );
    res.status(200).json(products);
  } catch (e) {
    webLogger(req, e);
    res.status(500).json({ status: "error" });
  }
});

app.post("/api/productDetail", async (req, res) => {
  const { url } = req.body;
  try {
    const productDetail = await crawlProductDetail(url);
    res.status(200).json(productDetail);
  } catch (e) {
    webLogger(req, e);
    res.status(500).json({ status: "error" });
  }
});

module.exports = server;
