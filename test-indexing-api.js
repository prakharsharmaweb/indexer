const axios = require("axios");
const { GoogleAuth } = require("google-auth-library");

async function run() {

  const auth = new GoogleAuth({
    keyFile: "./service-account.json", // your json file
    scopes: ["https://www.googleapis.com/auth/indexing"]
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  const response = await axios.post(
    "https://indexing.googleapis.com/v3/urlNotifications:publish",
    {
      url: "https://example.com/page",
      type: "URL_UPDATED"
    },
    {
      headers: {
        Authorization: `Bearer ${token.token}`,
        "Content-Type": "application/json"
      }
    }
  );

  console.log(response.data);
}

run();