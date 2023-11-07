const axios = require('axios');
const fs = require("fs");
const { parse } = require("csv-parse");
var KiteConnect = require("kiteconnect").KiteConnect;
var dateFormat = require('date-format');
const MongoClient = require('mongodb').MongoClient;



const quote = "https://api.kite.trade/quote?i=";
const instruments = "https://api.kite.trade/instruments";
const api_key = "";
const access_token = "";
const headers = {
  "X-Kite-Version": "3",
  "Authorization": `token ${api_key}:${access_token}`
};

const sl_hit_thresold = 2;
const strike_price='19300';//Strike price 
const name ='NIFTY'; // Stock name
const expiry_date='2023-11-09'; // Expiry for options (Call or put)
const sl_percent=2; // What will be SL in percent

var kc = new KiteConnect({api_key:""});
kc.setAccessToken(access_token);

const host = ""; // MongoDB connection string
const client = new MongoClient(host, { useUnifiedTopology: true });
let db;

const entry_time ="2023-11-06 13:24:00"; // Time when trade will execute
const square_off_time="2023-11-06 15:00:00";// Time when all open Trades will be squared off


async function connectToDatabase() {
  try {
    await client.connect();
    db = await client.db('database'); // Replace 'database' with your database name
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('Error connecting to MongoDB:', err);
  }
}

async function get_data(query) {
  const data = await db.collection('tradelog').find(query).toArray();
  return data;
}

async function update_data(query, data) {
  data.modified_at = new Date();
  const result = await db.collection('tradelog').updateOne(query, { $set: data });
  return result;
}

async function insert_orders(orders) {
  const result = await db.collection('tradelog').insertMany(orders);
  return result.insertedIds;
}

function timeToTimestamp(time) {
  const [hours, minutes, seconds, milliseconds] = time.split(/:|\./).map(Number);
  return hours * 3600000 + minutes * 60000 + seconds * 1000 + milliseconds;
}


const time_=timeToTimestamp(dateFormat('hh:mm:ss.SSS',new Date(entry_time)));  
const sq_time=timeToTimestamp(dateFormat('hh:mm:ss.SSS',new Date(square_off_time)));

async function find_entry() {

    const instResponse = await axios.get(`${instruments}/NFO`, { headers });
    const csvData = instResponse.data;
    const results = [];
    const parseStream = parse({ delimiter: ',', from_line: 2 });

    parseStream.on('data', (row) => {
      
     if(row[10]=== 'NFO-OPT'&& row[3]==name && row[5]===expiry_date && row[6]==strike_price){results.push(row);}
     
      });

    parseStream.on('end', () => {
      
       strategy(results);
    
    });

    parseStream.write(csvData);
    parseStream.end();

}

async function getLTP(symbol) {
  const url = `https://api.kite.trade/quote/ltp?i=${symbol}`;
 
  try {
    const response = await axios.get(url, { headers });
    const value=await response.data.data[symbol].last_price;
    return value;
  } catch (error) {
    console.error('Error fetching LTP:', error);
    throw error;
  }
}

async function calculate_sl(ltp){
  const sl_price=ltp*(1-(sl_percent/100));
  return sl_price;
}

async function strategy(results){
  const data={'CE': 0,
              'PE': 0
}

  for(i in results){console.log(results[i][2]);
    const index_symbol = `NFO:${results[i][2]}`;
    data[results[i][9]]= await getLTP(index_symbol);
    const sl= await calculate_sl(data[results[i][9]]);
    place_order(results[i][2],results[i][8],"BUY","MARKET",data[results[i][9]],sl);
    
  }
  //  console.log(data);
 
}

async function place_order(tradingsymbol, quantity, txn_type, order_type,price,sl){
  
  try {

      const requestData = {
      tradingsymbol: tradingsymbol,
      exchange: 'NFO',
      transaction_type: 'BUY',
      order_type: 'LIMIT',
      quantity: quantity,
      product: 'NRML',
      price:price,
      validity: 'DAY',

    };
  	 
      const response =await kc.placeOrder("amo", requestData);  
      const db_data=[{"order_id":response.order_id,"SL":sl,"tradingsymbol":tradingsymbol,requestData}];//Store in DB
      const db_id=await insert_orders(db_data);
 

  
} catch (e) {
    console.log(e.message);
}

}
async function sl_hit(){

 const db_sl_price=await db.collection('tradelog').find({"SL":{$exists:true}}).toArray();
 for(let i=0;i<db_sl_price.length;i++){
 const sl_price=db_sl_price[i].SL;
 const ltp=await getLTP(`${db_sl_price[i].requestData.exchange}:${db_sl_price[i].tradingsymbol}`);
 if(ltp<=sl_price) exit_position(db_sl_price[i].tradingsymbol);
 console.log(sl_price,ltp);
}
 
}

//Exit Single Position
async function exit_position(position){
  
 const posi_data=await db.collection('tradelog').find({tradingsymbol:position}).toArray();
 db.collection('tradelog').deleteOne({tradingsymbol:position});
 kc.cancelOrder("amo",return_data[i].order_id);

}

//Exit All Open Position
async function exit_all_positions(){

   const return_data = await db.collection('tradelog').find().toArray();
   db.collection('tradelog').deleteMany({});
   console.log(return_data);
   for(let i=0;i<return_data.length;i++){
   kc.cancelOrder("amo",return_data[i].order_id);

  }
  
}

async function main(){
  await connectToDatabase();
  const current_time=timeToTimestamp(dateFormat('hh:mm:ss.SSS',new Date()));

  if(current_time>time_&&current_time<sq_time){
    find_entry();
  }
  else if(current_time>=sq_time){ exit_all_positions();}

  else{console.log("Not time");}
}

 main();